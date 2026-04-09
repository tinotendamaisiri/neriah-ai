import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Server-side only — uses SERVICE_ROLE key. Never expose to client.
export const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
