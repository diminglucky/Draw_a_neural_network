import { buildDefaultApp } from "./app.js";

const app = await buildDefaultApp();
const port = Number(process.env.PORT || 4180);

await app.listen({ host: "127.0.0.1", port });
console.log(`Synapse foundation API running at http://127.0.0.1:${port}`);
