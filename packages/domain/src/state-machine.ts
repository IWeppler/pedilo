/**
 * Máquina de estados mínima y declarativa.
 *
 * Cada estado lista los estados a los que puede pasar. Un estado sin salidas es terminal.
 * La autoridad sobre los cambios de estado es siempre la API: las apps usan esto solo
 * para mostrar qué acciones tienen sentido, nunca para confirmar un cambio por su cuenta.
 */
export type TransitionMap<S extends string> = { readonly [K in S]: readonly S[] };

export interface StateMachine<S extends string> {
  readonly states: readonly S[];
  /** Estados alcanzables desde `from` en un paso. */
  next(from: S): readonly S[];
  canTransition(from: S, to: S): boolean;
  /** Lanza `InvalidTransitionError` si la transición no está permitida. */
  assertTransition(from: S, to: S): void;
  isTerminal(state: S): boolean;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`[${machine}] transición inválida: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function defineStateMachine<S extends string>(
  name: string,
  transitions: TransitionMap<S>,
): StateMachine<S> {
  const states = Object.keys(transitions) as S[];
  return {
    states,
    next: (from) => transitions[from],
    canTransition: (from, to) => transitions[from].includes(to),
    assertTransition(from, to) {
      if (!transitions[from].includes(to)) {
        throw new InvalidTransitionError(name, from, to);
      }
    },
    isTerminal: (state) => transitions[state].length === 0,
  };
}
