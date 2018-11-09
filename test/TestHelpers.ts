export function makeCallback(done, body) {
  return (...args) => {
    if (args[0] instanceof Error) {
      done.fail(args[0] as Error);
      return;
    }
    try {
      body(...args);
    } catch (error) {
      done.fail(error);
    }
  };
}
