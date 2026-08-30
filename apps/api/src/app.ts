import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { correlationMiddleware } from "./middleware/correlation";
import healthRouter from "./routes/health";
import usersRouter from "./routes/users";
import authRouter from "./routes/auth";
import mentorsRouter from "./routes/mentors";
import bookingsRouter from "./routes/bookings";

const app = express();

// Correlation ID & Structured Logging Middleware with AsyncLocalStorage
app.use(correlationMiddleware);

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

app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));

// Versioned API Routes (v1)
const v1Router = express.Router();
v1Router.use("/health", healthRouter);
v1Router.use("/users", usersRouter);
v1Router.use("/auth", authRouter);
v1Router.use("/mentors", mentorsRouter);
v1Router.use("/:orgId/mentors", mentorsRouter);
v1Router.use("/bookings", bookingsRouter);

app.use("/api/v1", v1Router);

export default app
