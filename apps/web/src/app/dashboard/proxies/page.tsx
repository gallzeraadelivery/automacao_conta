"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/apiClient";

interface Proxy {
  id: string;
  port: number;
  protocol: string;
  declaredRegion: string | null;
  status: string;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  INACTIVE: "bg-slate-100 text-slate-700",
  ERROR: "bg-red-100 text-red-800",
  UNTESTED: "bg-amber-100 text-amber-800",
};

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [host, setHost] = useState("");
  const [port, setPort] = useState("8080");
  const [protocol, setProtocol] = useState<"http" | "https" | "socks5">("http");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [declaredRegion, setDeclaredRegion] = useState("");

  async function loadProxies() {
    setLoading(true);
    const result = await apiRequest<Proxy[]>("/api/proxies");
    setLoading(false);
    if (result.success) {
      setProxies(result.data);
    } else {
      setError(result.error.message);
    }
  }

  useEffect(() => {
    loadProxies();
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const result = await apiRequest<Proxy>("/api/proxies", {
      method: "POST",
      body: JSON.stringify({
        host,
        port: Number(port),
        protocol,
        username: username || undefined,
        password: password || undefined,
        declaredRegion: declaredRegion || undefined,
      }),
    });

    if (result.success) {
      setHost("");
      setPort("8080");
      setUsername("");
      setPassword("");
      setDeclaredRegion("");
      await loadProxies();
    } else {
      setError(result.error.message);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    const result = await apiRequest<Proxy>(`/api/proxies/${id}/test`, { method: "POST" });
    setTestingId(null);
    if (result.success) {
      setProxies((prev) => prev.map((p) => (p.id === id ? result.data : p)));
    } else {
      setError(result.error.message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Proxies</h1>
        <p className="text-sm text-slate-500">
          Cadastre e teste a conectividade dos proxies usados na automação. Host e credenciais são
          criptografados e nunca exibidos após o cadastro.
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-3"
      >
        <input
          required
          placeholder="Host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="number"
          placeholder="Porta"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value as typeof protocol)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="http">http</option>
          <option value="https">https</option>
          <option value="socks5">socks5</option>
        </select>
        <input
          placeholder="Usuário (opcional)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Senha (opcional)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="Região declarada (opcional)"
          value={declaredRegion}
          onChange={(e) => setDeclaredRegion(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 sm:col-span-3 sm:w-fit"
        >
          Adicionar proxy
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Protocolo</th>
              <th className="px-4 py-2">Porta</th>
              <th className="px-4 py-2">Região</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Latência</th>
              <th className="px-4 py-2">Último teste</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-slate-500">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && proxies.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-slate-500">
                  Nenhum proxy cadastrado.
                </td>
              </tr>
            )}
            {proxies.map((proxy) => (
              <tr key={proxy.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{proxy.protocol}</td>
                <td className="px-4 py-2">{proxy.port}</td>
                <td className="px-4 py-2">{proxy.declaredRegion ?? "-"}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[proxy.status] ?? "bg-slate-100 text-slate-700"}`}
                  >
                    {proxy.status}
                  </span>
                </td>
                <td className="px-4 py-2">{proxy.latencyMs ? `${proxy.latencyMs} ms` : "-"}</td>
                <td className="px-4 py-2">
                  {proxy.lastCheckedAt
                    ? new Date(proxy.lastCheckedAt).toLocaleString("pt-BR")
                    : "-"}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleTest(proxy.id)}
                    disabled={testingId === proxy.id}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {testingId === proxy.id ? "Testando..." : "Testar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
