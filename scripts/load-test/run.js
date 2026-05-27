const { enqueue } = require('../../utils/queue');
(async () => {
  const jobs = [];
  for (let i = 0; i < 50; i++) jobs.push(enqueue('otp_retries', { mobile: `99999${i}` }, { dedupKey: `otp-${Date.now()}-${i}` }));
  for (let i = 0; i < 40; i++) jobs.push(enqueue('bulk_uploads', { batch: i }, { dedupKey: `bulk-${Date.now()}-${i}` }));
  for (let i = 0; i < 20; i++) jobs.push(enqueue('duplicate_processing', { req: i }, { dedupKey: `dup-${Date.now()}-${i}` }));
  for (let i = 0; i < 30; i++) jobs.push(enqueue('certificate_generation', { duplicate_request_id: i }, { dedupKey: `cert-${Date.now()}-${i}`, delayMs: 2000 }));
  for (let i = 0; i < 10; i++) jobs.push(enqueue('malware_scan', { file_path: i % 3 ? `uploads/temp/file${i}.pdf` : `uploads/temp/file${i}.exe` }, { dedupKey: `scan-${Date.now()}-${i}` }));
  await Promise.all(jobs);
  console.log('load test jobs queued');
  process.exit(0);
})();
