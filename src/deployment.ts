// Public static deployments have no local Node server or credential-bearing APIs.
export const browserOnly = import.meta.env.MODE === 'web'
