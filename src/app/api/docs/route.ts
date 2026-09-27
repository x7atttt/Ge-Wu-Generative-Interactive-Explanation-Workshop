import { NextResponse } from "next/server";
import { listDocs } from "@/lib/db/docs";

export async function GET() {
  return NextResponse.json({ docs: listDocs(20) });
}
