import { copyFile } from "node:fs/promises";

await copyFile("../../schemas/pack.schema.json", "dist/pack.schema.json");
