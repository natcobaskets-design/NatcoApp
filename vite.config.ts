import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ??
      env.VITE_FIREBASE_APP_ID?.split(':')[1] ?? '',
  }

  return {
    base: './',
    plugins: [
      react(),
      {
        name: 'natco-firebase-messaging-worker-config',
        closeBundle() {
          const workerPath = resolve('dist/firebase-messaging-sw.js')
          const worker = readFileSync(workerPath, 'utf8')
          if (!worker.includes('__NATCO_FIREBASE_CONFIG__')) {
            throw new Error('Firebase messaging worker config placeholder was not found.')
          }
          writeFileSync(
            workerPath,
            worker.replace('__NATCO_FIREBASE_CONFIG__', JSON.stringify(firebaseConfig)),
          )
        },
      },
    ],
  }
})
