import { useEffect, useState } from "react";

interface HealthCheckResponse {
  status: string;
  timestamp: string;
  databaseConfigured: boolean;
}

function App() {
  const [healthData, setHealthData] = useState<HealthCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000";

  useEffect(() => {
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
  }, [apiUrl]);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.logo}>Chronus</div>
        <div style={styles.badge}>v1.0.0-Beta</div>
      </header>

      <main style={styles.main}>
        <div style={styles.glassCard}>
          <h1 style={styles.title}>System Status Dashboard</h1>
          <p style={styles.subtitle}>
            Monorepo deployment orchestrating React, Express, and PostgreSQL
          </p>

          <div style={styles.statusSection}>
            <div style={styles.statusRow}>
              <span style={styles.label}>Frontend URL:</span>
              <code style={styles.code}>{window.location.origin}</code>
            </div>
            <div style={styles.statusRow}>
              <span style={styles.label}>Backend API URL:</span>
              <code style={styles.code}>{apiUrl}</code>
            </div>
          </div>

          <div style={styles.divider} />

          <div style={styles.responseCard}>
            <h3 style={styles.cardHeading}>API Connection Status</h3>
            {loading ? (
              <div style={styles.loader}>Checking connection...</div>
            ) : error ? (
              <div style={styles.errorContainer}>
                <span style={styles.errorDot} />
                <div>
                  <strong style={styles.errorTitle}>Unreachable</strong>
                  <p style={styles.errorMessage}>{error}</p>
                </div>
              </div>
            ) : (
              <div style={styles.successContainer}>
                <span style={styles.successDot} />
                <div>
                  <strong style={styles.successTitle}>Connected</strong>
                  <div style={styles.successGrid}>
                    <div>
                      <strong>Status:</strong> {healthData?.status}
                    </div>
                    <div>
                      <strong>Time:</strong> {healthData?.timestamp}
                    </div>
                    <div>
                      <strong>PostgreSQL Configuration:</strong>{" "}
                      {healthData?.databaseConfigured ? "Connected" : "Not Found"}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer style={styles.footer}>
        Built with Turborepo • Vite • Express • PostgreSQL • Docker
      </footer>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    backgroundColor: "#0B0F19",
    backgroundImage:
      "radial-gradient(circle at 10% 20%, rgba(120, 119, 198, 0.1) 0%, transparent 40%), radial-gradient(circle at 90% 80%, rgba(56, 189, 248, 0.05) 0%, transparent 50%)",
    color: "#F3F4F6",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  header: {
    padding: "1.5rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  },
  logo: {
    fontSize: "1.5rem",
    fontWeight: 800,
    background: "linear-gradient(to right, #38BDF8, #818CF8)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    letterSpacing: "-0.05em",
  },
  badge: {
    fontSize: "0.75rem",
    padding: "0.25rem 0.75rem",
    borderRadius: "9999px",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#9CA3AF",
  },
  main: {
    flex: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "2rem",
  },
  glassCard: {
    width: "100%",
    maxWidth: "540px",
    background: "rgba(17, 25, 40, 0.75)",
    backdropFilter: "blur(16px)",
    borderRadius: "16px",
    border: "1px solid rgba(255, 255, 255, 0.075)",
    padding: "2.5rem",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
  },
  title: {
    fontSize: "1.75rem",
    fontWeight: 700,
    marginBottom: "0.5rem",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    color: "#9CA3AF",
    fontSize: "0.95rem",
    lineHeight: 1.5,
    marginBottom: "1.5rem",
  },
  statusSection: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    padding: "0.75rem 1rem",
    borderRadius: "8px",
    border: "1px solid rgba(255, 255, 255, 0.03)",
  },
  label: {
    fontSize: "0.85rem",
    color: "#9CA3AF",
  },
  code: {
    fontFamily: 'monospace, Consolas, "Courier New"',
    fontSize: "0.85rem",
    color: "#38BDF8",
    fontWeight: 600,
  },
  divider: {
    height: "1px",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    margin: "1.5rem 0",
  },
  responseCard: {
    backgroundColor: "rgba(255, 255, 255, 0.02)",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    borderRadius: "10px",
    padding: "1.25rem",
  },
  cardHeading: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#E5E7EB",
    marginBottom: "1rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  loader: {
    fontSize: "0.9rem",
    color: "#9CA3AF",
  },
  errorContainer: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
  },
  errorDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: "#EF4444",
    marginTop: "0.3rem",
    boxShadow: "0 0 10px #EF4444",
  },
  errorTitle: {
    color: "#EF4444",
    fontSize: "0.95rem",
  },
  errorMessage: {
    color: "#9CA3AF",
    fontSize: "0.85rem",
    marginTop: "0.25rem",
  },
  successContainer: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
  },
  successDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: "#10B981",
    marginTop: "0.35rem",
    boxShadow: "0 0 10px #10B981",
  },
  successTitle: {
    color: "#10B981",
    fontSize: "0.95rem",
  },
  successGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.4rem",
    fontSize: "0.85rem",
    color: "#9CA3AF",
    marginTop: "0.5rem",
  },
  footer: {
    padding: "2rem",
    textAlign: "center" as const,
    fontSize: "0.8rem",
    color: "#4B5563",
    borderTop: "1px solid rgba(255, 255, 255, 0.03)",
  },
};

export default App;
