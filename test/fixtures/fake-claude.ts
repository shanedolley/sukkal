// A stand-in for `claude -p`, run as a real child process by
// test/inference-live.test.ts. It answers in the CLI's own JSON shape, and the
// `result` it gives back is a description of what the process received: the
// arguments, the environment and the prompt on stdin. The test then proves where
// the token did and did not travel.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const seen = {
    argv: process.argv.slice(2),
    env: process.env,
    input,
  };
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      api_error_status: null,
      result: JSON.stringify(seen),
    }),
  );
});
