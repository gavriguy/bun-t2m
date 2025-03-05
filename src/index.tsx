import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Array, Effect, Option, Queue, Schema, Stream } from "effect";
import html, { Html } from "@elysiajs/html";
import { Elysia, t } from "elysia";
import Markdoc from "@markdoc/markdoc";
const port = process.env.PORT || 3000;

const itemsPerPage = 10;
const lastPage = 3; //starting from 0

const app = new Elysia({
  serve: {
    idleTimeout: 0, // make sure we don't close the connection
  },
})
  .use(html())
  .get("/", () => "Hello Elysia!!!")
  .get("/test-doc1", async () => {
    const path = "./src/docs/test-doc1.md";
    const file = Bun.file(path);
    const doc = await file.text();
    const ast = Markdoc.parse(doc);
    const content = Markdoc.transform(ast);
    const rendered = Markdoc.renderers.html(content);
    return <div>{rendered}</div>;
  })
  .get(
    "/items",
    ({ query }) => {
      const currentPage = query.page || 0;
      const items = Array.makeBy(
        itemsPerPage,
        (i: number) => `Item ${currentPage * itemsPerPage + i}`
      );
      return { items, currentPage, itemsPerPage, lastPage };
    },
    { query: t.Object({ page: t.Optional(t.Number()) }) }
  )
  .get("/items-paginated-stream", async function* ({ server }) {
    if (!server) {
      throw new Error("Server is not available");
    }
    const queue = Effect.runSync(Queue.unbounded<string>());
    const program = Effect.gen(function* () {
      const stream = Stream.paginateEffect(0, (n) =>
        Effect.gen(function* () {
          yield* Effect.sleep(500);
          const currentPage = n;
          const url = new URL(`items?page=${n}`, server.url.origin);
          console.log(url.href);
          const res = yield* HttpClientRequest.get(url.href).pipe(
            HttpClient.execute,
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                Schema.Struct({ items: Schema.Array(Schema.String) })
              )
            )
          );

          yield* Queue.offer(queue, res.items.join("\n") + "\n");
          console.log(`Page ${currentPage} fetched`);
          const isEnded = currentPage >= lastPage;
          const next = isEnded ? Option.none() : Option.some(n + 1);

          if (isEnded) yield* Queue.offer(queue, "Done");

          return [n, next];
        })
      );
      yield* Stream.runDrain(stream);
    });
    Effect.runFork(
      program.pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
    );
    while (true) {
      console.log("--");
      const data = await Effect.runPromise(Queue.take(queue));
      if (data === "Done") {
        break;
      }
      yield data;
    }
  })
  .listen(port);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
