"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} as const;

export function getBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const url = getRequiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = getRequiredPublicEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  browserClient = createClient(url, publishableKey);
  return browserClient;
}

function getRequiredPublicEnv(name: string): string {
  const value = publicEnv[name as keyof typeof publicEnv]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}
