export type Database = {
  public: {
    Tables: {
      contact_submissions: {
        Row: {
          id:              string
          created_at:      string
          first_name:      string
          last_name:       string
          school_name:     string
          city:            string | null
          role:            string
          whatsapp_number: string | null
          email:           string
          subject:         string | null
          message:         string | null
          status:          'new' | 'contacted' | 'converted' | 'closed'
        }
        Insert: {
          first_name:      string
          last_name:       string
          school_name:     string
          city:            string | null
          role:            string
          whatsapp_number: string | null
          email:           string
          subject?:        string | null
          message?:        string | null
        }
        Update: {
          id?:              string
          created_at?:      string
          first_name?:      string
          last_name?:       string
          school_name?:     string
          city?:            string | null
          role?:            string
          whatsapp_number?: string | null
          email?:           string
          subject?:         string | null
          message?:         string | null
          status?:          'new' | 'contacted' | 'converted' | 'closed'
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          id:              string
          created_at:      string
          email:           string
          confirmed:       boolean
          unsubscribed_at: string | null
        }
        Insert: { email: string }
        Update: {
          id?:              string
          created_at?:      string
          email?:           string
          confirmed?:       boolean
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
