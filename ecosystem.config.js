module.exports = {
  apps: [
    {
      name: 'bar-council-api',
      script: 'server.js',
      instances: process.env.API_INSTANCES || 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: process.env.PM2_API_MAX_MEMORY || '500M',
      env: { NODE_ENV: 'production', PROCESS_ROLE: 'api' }
    },
    {
      name: 'bar-council-queue-workers',
      script: 'server.js',
      instances: process.env.QUEUE_INSTANCES || 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: process.env.PM2_QUEUE_MAX_MEMORY || '400M',
      env: { NODE_ENV: 'production', PROCESS_ROLE: 'queue' }
    },
    {
      name: 'bar-council-scheduler',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '250M',
      env: { NODE_ENV: 'production', PROCESS_ROLE: 'scheduler' }
    }
  ]
};
