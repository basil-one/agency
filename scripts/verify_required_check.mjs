export function assertSuccessfulPrerequisite(result) {
  if (result !== 'success') {
    throw new Error(
      `Required check prerequisite was '${result ?? 'unknown'}'; expected 'success'.`
    );
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    assertSuccessfulPrerequisite(process.env.PREREQUISITE_RESULT);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
