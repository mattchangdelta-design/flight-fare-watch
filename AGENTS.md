<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Auth uses Lovable Cloud built-in auth.users only (no app tables); app data will live outside this backend. Why: course architecture keeps Supabase auth-only.
- Plain Vite + React SPA (no SSR, no server functions). Routes are declared in src/routes.tsx with React Router; pages live in src/pages/. Why: deployed as static files to Vercel.
- Signed-in pages are nested under <RequireAuth /> in src/routes.tsx (client-only gate redirecting to /signin). Why: session is in localStorage.
- vercel.json rewrites every path to /index.html so deep links like /app resolve client-side.
