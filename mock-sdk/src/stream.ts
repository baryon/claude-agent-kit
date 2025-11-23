/**
 * Async Message Stream Implementation
 */

export class AsyncMessageStream<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private queue: T[] = [];
  private resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private rejecters: Array<(reason?: unknown) => void> = [];
  private closed = false;
  private failure?: unknown;

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.resolvers.push(resolve);
      this.rejecters.push(reject);
    });
  }

  enqueue(value: T): void {
    if (this.closed || this.failure) {
      return;
    }
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      this.rejecters.shift();
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  complete(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      this.rejecters.shift();
      resolve({ value: undefined, done: true });
    }
  }

  throw(error: unknown): Promise<IteratorResult<T>> {
    this.fail(error);
    return Promise.reject(error);
  }

  fail(error: unknown): void {
    if (this.failure) {
      return;
    }
    this.failure = error;
    while (this.rejecters.length > 0) {
      const reject = this.rejecters.shift()!;
      this.resolvers.shift();
      reject(error);
    }
  }

  return(): Promise<IteratorResult<T>> {
    this.complete();
    return Promise.resolve({ value: undefined, done: true });
  }
}
