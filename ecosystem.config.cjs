module.exports = {
  apps: [{
    name: 'analyst',
    script: './server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    // 768M: conservative headroom above the ~260k-row cohort-building refactor's actual peak
    // (routes/lifecycle.js now aggregates via SQL GROUP BY instead of loading full row sets into
    // JS, and caches the 4 heaviest endpoints for 90s), on a 3.7GB box shared with Kaki
    // (production) and n8n (~500MB baseline) plus the 2GB swap file added alongside this change.
    // Re-measure actual peak usage before raising further.
    max_memory_restart: '768M',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
}
