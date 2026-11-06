import { createApp } from "./app.mjs";
const port = Number(process.env.PORT || 4317);
const { app, close } = createApp({
  dbPath: process.env.STAGELEAF_DB || "data/stageleaf.sqlite",
});
const server = app.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(`Stageleaf is running on port ${port}.`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      close();
      process.exit(0);
    }),
  );
