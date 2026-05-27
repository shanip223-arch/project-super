module.exports = {
  apps: [
    {
      name: 'bar-council-portal',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' }
    }
  ]
};
