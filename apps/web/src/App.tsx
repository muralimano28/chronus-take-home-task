import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
} from "@chronus/ui";
import { Terminal, Database, Server, RefreshCw, Layers, ShieldCheck, AlertCircle } from "lucide-react";

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  databaseConfigured: boolean;
}

function App() {
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

  useEffect(() => {
    setLoading(true);
    fetch(`${apiUrl}/health`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json() as Promise<HealthCheckResponse>;
      })
      .then((data) => {
        setHealthData(data);
        setError(null);
      })
      .catch((err) => {
        console.error("Error fetching api health:", err);
        setError(err.message || "Failed to reach the API server");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiUrl, refreshKey]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col relative overflow-hidden selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Background Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-violet-600/10 rounded-full blur-[150px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 border-b border-zinc-800/80 bg-zinc-950/40 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="h-5 w-5 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
              Chronus
            </span>
            <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Monorepo
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((prev) => prev + 1)}
            disabled={loading}
            className="border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:text-white transition-all duration-200 text-zinc-400 gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10 max-w-4xl w-full mx-auto px-6 py-12 flex flex-col justify-center">
        <Card className="border-zinc-800/80 bg-zinc-950/60 backdrop-blur-xl shadow-2xl shadow-black/40 p-2 md:p-4">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-2xl md:text-3xl font-bold bg-gradient-to-b from-white to-zinc-300 bg-clip-text text-transparent">
                System Status Dashboard
              </CardTitle>
              <CardDescription className="text-zinc-400 text-sm md:text-base">
                Orchestrating modern frontend applications, REST API gateways, and PostgreSQL database layers.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* System Endpoints */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800/60 bg-zinc-900/30">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-zinc-800/60 text-zinc-300">
                    <Terminal className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Frontend App</p>
                    <p className="text-sm font-semibold text-zinc-300">{window.location.origin}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800/60 bg-zinc-900/30">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-zinc-800/60 text-zinc-300">
                    <Server className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Backend Gateway</p>
                    <p className="text-sm font-semibold text-zinc-300">{apiUrl}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Connection Status Section */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/80 p-5 md:p-6">
              <h3 className="text-sm font-semibold text-zinc-400 mb-4 uppercase tracking-wider flex items-center gap-2">
                <Database className="h-4 w-4 text-indigo-400" />
                Live Integration Health
              </h3>

              {loading ? (
                <div className="flex items-center gap-3 py-4 text-zinc-400 text-sm animate-pulse">
                  <div className="h-4 w-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                  Requesting system status...
                </div>
              ) : error ? (
                <div className="flex gap-4 p-4 rounded-lg bg-red-950/20 border border-red-900/30 text-red-200">
                  <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-red-400">Gateway Unreachable</h4>
                    <p className="text-sm text-zinc-400 mt-1">{error}</p>
                    <p className="text-xs text-zinc-500 mt-2">
                      Please ensure the API backend is running (`npm run dev` at the root) and CORS policies allow requests from this origin.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2.5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-sm font-semibold text-emerald-400">API Operational & Verified</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                    <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-900">
                      <p className="text-xs text-zinc-500 mb-0.5">Status code</p>
                      <p className="text-sm font-semibold text-zinc-200">{healthData?.status}</p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-900">
                      <p className="text-xs text-zinc-500 mb-0.5">Server Timestamp</p>
                      <p className="text-sm font-semibold text-zinc-200 truncate" title={healthData?.timestamp}>
                        {healthData ? new Date(healthData.timestamp).toLocaleTimeString() : "-"}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-900">
                      <p className="text-xs text-zinc-500 mb-0.5">PostgreSQL Link</p>
                      <p className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                        {healthData?.databaseConfigured ? (
                          <>
                            <ShieldCheck className="h-4 w-4 text-emerald-500" />
                            Connected
                          </>
                        ) : (
                          "Disconnected"
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-zinc-900/60 bg-zinc-950/20 py-6 text-center text-xs text-zinc-600">
        Built with Turborepo • Vite • Express • PostgreSQL • Tailwind CSS v4 • shadcn/ui
      </footer>
    </div>
  );
}

export default App;
