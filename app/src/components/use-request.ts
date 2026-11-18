import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../transit';

export function useRequest<T>() {
  const [state, setState] = useState<{ value?: T; busy?: boolean; error?: string }>({});
  const revision = useRef({ current: 0 }).current;
  useEffect(() => () => { revision.current++; }, [revision]);

  async function run(load: () => Promise<T>) {
    const id = ++revision.current;
    setState({ busy: true });
    try {
      const value = await load();
      if (id === revision.current) setState({ value });
    } catch (error) {
      if (id === revision.current) setState({ error: errorMessage(error) });
    }
  }

  function clear() {
    revision.current++;
    setState({});
  }

  return { ...state, run, clear };
}
