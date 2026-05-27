const profiles = {
  local: { fakeOtp: true, fakePayment: true, queueTestMode: true, db: 'database.sqlite' },
  staging: { fakeOtp: true, fakePayment: true, queueTestMode: false, db: process.env.STAGING_DB_PATH || 'staging.sqlite' },
  production: { fakeOtp: false, fakePayment: false, queueTestMode: false, db: process.env.PROD_DB_PATH || 'database.sqlite' }
};

function getEnvProfile() {
  const env = (process.env.APP_ENV || process.env.NODE_ENV || 'local').toLowerCase();
  return { name: profiles[env] ? env : 'local', ...profiles[env] || profiles.local };
}

module.exports = { getEnvProfile };
