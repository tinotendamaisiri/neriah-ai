import NextAuth from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // Only allow specific emails
      const allowed = (process.env.ALLOWED_STUDIO_EMAILS || '')
        .split(',')
        .map(e => e.trim())
      return allowed.includes(profile?.email || '')
    },
    async session({ session }) {
      return session
    },
  },
})

export { handler as GET, handler as POST }
