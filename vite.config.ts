import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: mode === 'web' ? '/Today-public-candidate/' : '/',
  plugins: [react()],
  // Keep cold development startup on one React identity and prebundle all entry points.
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: {
    include: [
      // The lazy Worker SDK must be discovered before the first dev response;
      // late optimization otherwise reloads the page and resets open fixture dialogs.
      '@mlc-ai/web-llm',
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ],
  },
}))
