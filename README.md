# Chronus Monorepo

A standard, production-ready Turborepo monorepo workspace structured with a Vite (React) frontend, a Node.js (Express) backend API, and a PostgreSQL database.

---

## 🛠️ Development Setup

During development, we run the services directly on the host machine using Turborepo for fast compilation and hot-reloading, while keeping PostgreSQL running in a lightweight Docker container.

### Prerequisites
Make sure you have [pnpm](https://pnpm.io/) and [Docker](https://www.docker.com/) installed.

### 1. Start the Database
Spin up the PostgreSQL database container in the background:
```bash
docker compose up -d postgres
```

### 2. Configure Environment Variables
Create the environment files for both apps:

* **Backend (`apps/api/.env`)**:
  ```ini
  PORT=3010
  DATABASE_URL=postgres://postgres:password@localhost:5432/chronus_db
  ```

* **Frontend (`apps/web/.env`)**:
  ```ini
  VITE_API_URL=http://localhost:3010
  ```

### 3. Install Dependencies
From the root of the monorepo:
```bash
pnpm install
```

### 4. Run Development Servers
Start the Turborepo development runner:
```bash
pnpm dev
```

* **Frontend** will be available at `http://localhost:3000` (or fallback port).
* **Backend API** will be available at `http://localhost:3010`.

---

## 🚀 Production Deployment (Docker Compose)

In production, all components are containerized. The frontend uses multi-stage Docker builds compiled to static files and served efficiently using Nginx.

### 1. Build and Run the Complete Stack
From the root directory, run:
```bash
docker compose up --build
```

Docker Compose orchestrates three services:
1. **`postgres`**: Exposes PostgreSQL database port `5432` internally.
2. **`api`**: Exposes Node.js Express server on port `3010`.
3. **`web`**: Serves Vite production static assets through Nginx on port `80`.

### 2. Accessing the Application
* **Frontend Web Application**: Open `http://localhost/` (port `80`).
* **Backend Health Check**: Open `http://localhost:3010/health`.

### 3. Docker Optimization Details
Both frontend and backend utilize `turbo prune` in their multi-stage Dockerfiles. This ensures that:
* Only relevant package dependencies are fetched.
* Image build layers are highly cached, speeding up CI/CD pipeline deployments significantly.
