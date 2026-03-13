"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";

type Role = "one" | "two";
type GameStatus = "waiting" | "choosing" | "playing" | "finished";

type GameState = {
  code: string;
  status: GameStatus;
  currentTurn: Role;
  winner: Role | null;
  viewerRole: Role | null;
  youName: string | null;
  opponentName: string | null;
  youSelected: boolean;
  opponentSelected: boolean;
  canGuess: boolean;
  history: string[];
  lastMessage: string;
};

type Session = {
  code: string;
  playerId: string;
};

const SESSION_STORAGE_KEY = "online-guess-session";
const SESSION_STORAGE_EVENT = "online-guess-session-change";

function readStoredSessionRaw(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
}

function setStoredSession(session: Session | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (session) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
  window.dispatchEvent(new Event(SESSION_STORAGE_EVENT));
}

function subscribeSession(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handleChange = () => onStoreChange();
  window.addEventListener("storage", handleChange);
  window.addEventListener(SESSION_STORAGE_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(SESSION_STORAGE_EVENT, handleChange);
  };
}

function parseNumber(value: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 100) {
    return null;
  }
  return number;
}

export default function Home() {
  const [name, setName] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const sessionRaw = useSyncExternalStore(subscribeSession, readStoredSessionRaw, () => null);
  const session = useMemo(() => {
    if (!sessionRaw) {
      return null;
    }
    try {
      const parsed = JSON.parse(sessionRaw) as Session;
      if (parsed.code && parsed.playerId) {
        return parsed;
      }
      return null;
    } catch {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
      return null;
    }
  }, [sessionRaw]);
  const [state, setState] = useState<GameState | null>(null);
  const [secretInput, setSecretInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [statusText, setStatusText] = useState("Create room or join with room code.");
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchState = async () => {
      const response = await fetch(
        `/api/game?code=${encodeURIComponent(session.code)}&playerId=${encodeURIComponent(session.playerId)}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as
        | { ok: true; data: GameState }
        | { ok: false; error: string };

      if (!result.ok) {
        setStatusText(result.error);
        return;
      }
      setState(result.data);
      setStatusText(result.data.lastMessage);
    };

    void fetchState();
    const timer = setInterval(() => {
      void fetchState();
    }, 1000);

    return () => clearInterval(timer);
  }, [session]);

  const turnText = useMemo(() => {
    if (!state) {
      return "";
    }
    if (state.status === "finished" && state.winner) {
      return `${state.winner === state.viewerRole ? "You" : state.opponentName ?? "Opponent"} won`;
    }
    if (state.status === "playing") {
      return state.canGuess
        ? "Your turn to guess"
        : `${state.opponentName ?? "Opponent"} is guessing now`;
    }
    if (state.status === "choosing") {
      return "Both players must choose a secret number";
    }
    return "Waiting for Player 2 to join";
  }, [state]);

  const progressStep = useMemo(() => {
    if (!state) {
      return 0;
    }
    if (state.status === "waiting") {
      return 1;
    }
    if (state.status === "choosing") {
      return 2;
    }
    if (state.status === "playing") {
      return 3;
    }
    return 4;
  }, [state]);

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        name,
      }),
    });
    const result = (await response.json()) as
      | { ok: true; data: Session }
      | { ok: false; error: string };

    setLoading(false);
    if (!result.ok) {
      setStatusText(result.error);
      return;
    }

    setStoredSession(result.data);
    setState(null);
    setSecretInput("");
    setGuessInput("");
    setStatusText("Room created. Share your room code with Player 2.");
  };

  const handleJoinRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const roomCode = joinCodeInput.trim().toUpperCase();
    if (!roomCode) {
      setStatusText("Enter room code");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "join",
        code: roomCode,
        name,
      }),
    });
    const result = (await response.json()) as
      | { ok: true; data: Session }
      | { ok: false; error: string };

    setLoading(false);
    if (!result.ok) {
      setStatusText(result.error);
      return;
    }
    setStoredSession(result.data);
    setState(null);
    setSecretInput("");
    setGuessInput("");
    setStatusText("Joined room. Choose your secret number.");
  };

  const handleChooseSecret = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) {
      return;
    }
    const number = parseNumber(secretInput);
    if (number === null) {
      setStatusText("Secret number must be 1 to 100");
      return;
    }

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "choose",
        code: session.code,
        playerId: session.playerId,
        number,
      }),
    });
    const result = (await response.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      setStatusText(result.error ?? "Could not set secret number");
      return;
    }
    setStatusText("Secret saved.");
    setSecretInput("");
  };

  const handleGuess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) {
      return;
    }
    const guess = parseNumber(guessInput);
    if (guess === null) {
      setStatusText("Guess must be 1 to 100");
      return;
    }

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "guess",
        code: session.code,
        playerId: session.playerId,
        guess,
      }),
    });
    const result = (await response.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      setStatusText(result.error ?? "Guess failed");
      return;
    }
    setGuessInput("");
    setStatusText("Guess submitted.");
  };

  const handleLeaveRoom = () => {
    setStoredSession(null);
    setState(null);
    setName("");
    setJoinCodeInput("");
    setSecretInput("");
    setGuessInput("");
    setCopiedCode(false);
    setStatusText("Create room or join with room code.");
  };

  const handleCopyCode = async () => {
    if (!session) {
      return;
    }
    await navigator.clipboard.writeText(session.code);
    setCopiedCode(true);
    setStatusText("Room code copied.");
    setTimeout(() => {
      setCopiedCode(false);
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-white to-cyan-100 p-4 text-zinc-900 md:p-8 md:pt-35">
      <main className="mx-auto w-full max-w-4xl rounded-3xl border border-white/60 bg-white/80 p-6 shadow-2xl backdrop-blur md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">
              2 Player Online Guess Game
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Private room code, live turns, higher-lower hints.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Live sync every 1s
          </div>
        </div>

        {!session ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5">
              <h2 className="text-lg font-bold text-indigo-900">Create Private Room</h2>
              <p className="mt-1 text-sm text-indigo-700">Host creates a code and shares it.</p>
              <form className="mt-4 space-y-3" onSubmit={handleCreateRoom}>
                <label className="block text-sm font-medium">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 outline-none ring-indigo-400 transition focus:ring-2"
                  placeholder="Optional"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                >
                  {loading ? "Creating..." : "Create Room"}
                </button>
              </form>
            </div>

            <div className="rounded-2xl border border-cyan-100 bg-gradient-to-br from-cyan-50 to-white p-5">
              <h2 className="text-lg font-bold text-cyan-900">Join by Code</h2>
              <p className="mt-1 text-sm text-cyan-700">Friend enters your 6-character code.</p>
              <form className="mt-4 space-y-3" onSubmit={handleJoinRoom}>
                <label className="block text-sm font-medium">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl border border-cyan-200 bg-white px-3 py-2 outline-none ring-cyan-400 transition focus:ring-2"
                  placeholder="Optional"
                />
                <label className="block text-sm font-medium">Room code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinCodeInput}
                    onChange={(event) => setJoinCodeInput(event.target.value.toUpperCase())}
                    className="flex-1 rounded-xl border border-cyan-200 bg-white px-3 py-2 font-semibold uppercase tracking-widest outline-none ring-cyan-400 transition focus:ring-2"
                    placeholder="ABC123"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-xl bg-cyan-600 px-4 py-2.5 font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-60"
                  >
                    Join
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : (
          <div className="mt-8 space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:col-span-2">
                <p className="text-xs font-semibold text-zinc-500">PRIVATE ROOM CODE</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="rounded-xl bg-zinc-900 px-4 py-2 text-lg font-black tracking-[0.3em] text-white">
                    {session.code}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold transition hover:bg-zinc-100"
                  >
                    {copiedCode ? "Copied" : "Copy Code"}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
                <p className="text-xs font-semibold text-emerald-700">GAME STATUS</p>
                <p className="mt-2 text-sm font-bold text-emerald-900">{turnText}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-zinc-500">PROGRESS</p>
              <div className="mt-3 grid grid-cols-4 gap-2 text-xs font-semibold">
                <div className={`rounded-lg px-2 py-2 text-center ${progressStep >= 1 ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-500"}`}>Room</div>
                <div className={`rounded-lg px-2 py-2 text-center ${progressStep >= 2 ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-500"}`}>Choose</div>
                <div className={`rounded-lg px-2 py-2 text-center ${progressStep >= 3 ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-500"}`}>Play</div>
                <div className={`rounded-lg px-2 py-2 text-center ${progressStep >= 4 ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-500"}`}>Win</div>
              </div>
            </div>

            {state && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold text-zinc-500">PLAYERS</p>
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="rounded-lg bg-zinc-100 px-3 py-2">You: {state.youName ?? "Unknown"}</p>
                    <p className="rounded-lg bg-zinc-100 px-3 py-2">Opponent: {state.opponentName ?? "Waiting..."}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold text-zinc-500">READY CHECK</p>
                  <div className="mt-2 space-y-2 text-sm">
                    <p className="rounded-lg bg-zinc-100 px-3 py-2">
                      Your secret selected: <span className="font-bold">{state.youSelected ? "Yes" : "No"}</span>
                    </p>
                    <p className="rounded-lg bg-zinc-100 px-3 py-2">
                      Opponent selected: <span className="font-bold">{state.opponentSelected ? "Yes" : "No"}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {state && state.status !== "waiting" && !state.youSelected && (
              <form className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm" onSubmit={handleChooseSecret}>
                <p className="text-sm font-bold text-violet-900">Choose your secret number</p>
                <div className="mt-3 flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={secretInput}
                    onChange={(event) => setSecretInput(event.target.value)}
                    className="flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2 outline-none ring-violet-400 transition focus:ring-2"
                    placeholder="1 - 100"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-violet-600 px-4 py-2.5 font-semibold text-white transition hover:bg-violet-700"
                  >
                    Save Secret
                  </button>
                </div>
              </form>
            )}

            {state?.canGuess && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <form className="flex gap-2" onSubmit={handleGuess}>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={guessInput}
                    onChange={(event) => setGuessInput(event.target.value)}
                    className="flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 outline-none ring-amber-400 transition focus:ring-2"
                    placeholder="Enter your guess"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-amber-500 px-4 py-2.5 font-semibold text-white transition hover:bg-amber-600"
                  >
                    Guess
                  </button>
                </form>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[10, 25, 50, 75, 90].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGuessInput(String(value))}
                      className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-amber-100"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-zinc-800">Game History</h2>
              <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto text-sm text-zinc-700">
                {state?.history.map((item, index) => (
                  <li
                    key={`${item}-${index}`}
                    className={`rounded-lg px-3 py-2 ${index === state.history.length - 1 ? "bg-indigo-50 font-medium text-indigo-900" : "bg-zinc-50"}`}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleLeaveRoom}
                className="rounded-xl border border-zinc-300 px-4 py-2 font-semibold transition hover:bg-zinc-100"
              >
                Leave Room
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 font-semibold text-indigo-700 transition hover:bg-indigo-100"
              >
                Refresh Now
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-sm">
          {statusText}
        </div>
      </main>
    </div>
  );
}
