module.exports = {
  apps: [
    {
      name: 'bar-council-portal',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' }
    }
  ]
};
