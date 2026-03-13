import { NextRequest, NextResponse } from "next/server";
import {
  createRoom,
  getPublicState,
  joinRoom,
  setSecretNumber,
  submitGuess,
} from "@/lib/onlineGameStore";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const playerId = request.nextUrl.searchParams.get("playerId") ?? "";
  const state = getPublicState(code, playerId);
  if (!state.ok) {
    return NextResponse.json({ ok: false, error: state.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, data: state.data });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    action?: string;
    code?: string;
    playerId?: string;
    name?: string;
    number?: number;
    guess?: number;
  };

  const action = body.action;

  if (action === "create") {
    const created = createRoom(body.name ?? "");
    return NextResponse.json({ ok: true, data: created });
  }

  if (action === "join") {
    const joined = joinRoom(body.code ?? "", body.name ?? "");
    if (!joined.ok) {
      return NextResponse.json({ ok: false, error: joined.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, data: joined.data });
  }

  if (action === "choose") {
    const result = setSecretNumber(body.code ?? "", body.playerId ?? "", Number(body.number));
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "guess") {
    const result = submitGuess(body.code ?? "", body.playerId ?? "", Number(body.guess));
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
}
