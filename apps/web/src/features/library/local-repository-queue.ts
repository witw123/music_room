type LocalRepositoryTask<T> = () => Promise<T>;

let localRepositoryWriteChain = Promise.resolve();

export function enqueueLocalRepositoryWrite<T>(task: LocalRepositoryTask<T>) {
  const operation = localRepositoryWriteChain.then(task);
  localRepositoryWriteChain = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}
