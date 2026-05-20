import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve the single-page frontend from the public directory.
// __dirname is injected by the esbuild banner and always points to dist/,
// so ../public resolves to artifacts/api-server/public in both dev and prod.
const publicDir = path.join(__dirname, "../public");
app.use(express.static(publicDir));

app.use("/api", router);

// Fallback: any non-API route returns index.html (SPA support)
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
