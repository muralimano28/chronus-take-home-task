import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const databaseUrl = process.env.DATABASE_URL;

// Enable CORS for port 80 (and default origin for local dev debugging if needed)
app.use(
  cors({
    origin: [
      "http://localhost",
      "http://localhost:80",
      "http://localhost:3000",
      "http://localhost:5173", // default vite port
    ],
    credentials: true,
  })
);

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    databaseConfigured: !!databaseUrl,
  });
});

app.listen(port, () => {
  console.log(`[server]: API Server is running on port ${port}`);
});
