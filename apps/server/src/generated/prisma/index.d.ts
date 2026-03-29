
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model GuestSession
 * 
 */
export type GuestSession = $Result.DefaultSelection<Prisma.$GuestSessionPayload>
/**
 * Model RoomState
 * 
 */
export type RoomState = $Result.DefaultSelection<Prisma.$RoomStatePayload>
/**
 * Model Playlist
 * 
 */
export type Playlist = $Result.DefaultSelection<Prisma.$PlaylistPayload>

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more GuestSessions
 * const guestSessions = await prisma.guestSession.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  const U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more GuestSessions
   * const guestSessions = await prisma.guestSession.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.guestSession`: Exposes CRUD operations for the **GuestSession** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more GuestSessions
    * const guestSessions = await prisma.guestSession.findMany()
    * ```
    */
  get guestSession(): Prisma.GuestSessionDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.roomState`: Exposes CRUD operations for the **RoomState** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more RoomStates
    * const roomStates = await prisma.roomState.findMany()
    * ```
    */
  get roomState(): Prisma.RoomStateDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.playlist`: Exposes CRUD operations for the **Playlist** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Playlists
    * const playlists = await prisma.playlist.findMany()
    * ```
    */
  get playlist(): Prisma.PlaylistDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 6.19.2
   * Query Engine version: c2990dca591cba766e3b7ef5d9e8a84796e47ab7
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import Bytes = runtime.Bytes
  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    GuestSession: 'GuestSession',
    RoomState: 'RoomState',
    Playlist: 'Playlist'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "guestSession" | "roomState" | "playlist"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      GuestSession: {
        payload: Prisma.$GuestSessionPayload<ExtArgs>
        fields: Prisma.GuestSessionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.GuestSessionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.GuestSessionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>
          }
          findFirst: {
            args: Prisma.GuestSessionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.GuestSessionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>
          }
          findMany: {
            args: Prisma.GuestSessionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>[]
          }
          create: {
            args: Prisma.GuestSessionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>
          }
          createMany: {
            args: Prisma.GuestSessionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.GuestSessionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>[]
          }
          delete: {
            args: Prisma.GuestSessionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>
          }
          update: {
            args: Prisma.GuestSessionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>
          }
          deleteMany: {
            args: Prisma.GuestSessionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.GuestSessionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.GuestSessionUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>[]
          }
          upsert: {
            args: Prisma.GuestSessionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$GuestSessionPayload>
          }
          aggregate: {
            args: Prisma.GuestSessionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateGuestSession>
          }
          groupBy: {
            args: Prisma.GuestSessionGroupByArgs<ExtArgs>
            result: $Utils.Optional<GuestSessionGroupByOutputType>[]
          }
          count: {
            args: Prisma.GuestSessionCountArgs<ExtArgs>
            result: $Utils.Optional<GuestSessionCountAggregateOutputType> | number
          }
        }
      }
      RoomState: {
        payload: Prisma.$RoomStatePayload<ExtArgs>
        fields: Prisma.RoomStateFieldRefs
        operations: {
          findUnique: {
            args: Prisma.RoomStateFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.RoomStateFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>
          }
          findFirst: {
            args: Prisma.RoomStateFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.RoomStateFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>
          }
          findMany: {
            args: Prisma.RoomStateFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>[]
          }
          create: {
            args: Prisma.RoomStateCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>
          }
          createMany: {
            args: Prisma.RoomStateCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.RoomStateCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>[]
          }
          delete: {
            args: Prisma.RoomStateDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>
          }
          update: {
            args: Prisma.RoomStateUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>
          }
          deleteMany: {
            args: Prisma.RoomStateDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.RoomStateUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.RoomStateUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>[]
          }
          upsert: {
            args: Prisma.RoomStateUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RoomStatePayload>
          }
          aggregate: {
            args: Prisma.RoomStateAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRoomState>
          }
          groupBy: {
            args: Prisma.RoomStateGroupByArgs<ExtArgs>
            result: $Utils.Optional<RoomStateGroupByOutputType>[]
          }
          count: {
            args: Prisma.RoomStateCountArgs<ExtArgs>
            result: $Utils.Optional<RoomStateCountAggregateOutputType> | number
          }
        }
      }
      Playlist: {
        payload: Prisma.$PlaylistPayload<ExtArgs>
        fields: Prisma.PlaylistFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PlaylistFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PlaylistFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>
          }
          findFirst: {
            args: Prisma.PlaylistFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PlaylistFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>
          }
          findMany: {
            args: Prisma.PlaylistFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>[]
          }
          create: {
            args: Prisma.PlaylistCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>
          }
          createMany: {
            args: Prisma.PlaylistCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PlaylistCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>[]
          }
          delete: {
            args: Prisma.PlaylistDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>
          }
          update: {
            args: Prisma.PlaylistUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>
          }
          deleteMany: {
            args: Prisma.PlaylistDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PlaylistUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PlaylistUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>[]
          }
          upsert: {
            args: Prisma.PlaylistUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PlaylistPayload>
          }
          aggregate: {
            args: Prisma.PlaylistAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePlaylist>
          }
          groupBy: {
            args: Prisma.PlaylistGroupByArgs<ExtArgs>
            result: $Utils.Optional<PlaylistGroupByOutputType>[]
          }
          count: {
            args: Prisma.PlaylistCountArgs<ExtArgs>
            result: $Utils.Optional<PlaylistCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Shorthand for `emit: 'stdout'`
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events only
     * log: [
     *   { emit: 'event', level: 'query' },
     *   { emit: 'event', level: 'info' },
     *   { emit: 'event', level: 'warn' }
     *   { emit: 'event', level: 'error' }
     * ]
     * 
     * / Emit as events and log to stdout
     * og: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * 
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Instance of a Driver Adapter, e.g., like one provided by `@prisma/adapter-planetscale`
     */
    adapter?: runtime.SqlDriverAdapterFactory | null
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
  }
  export type GlobalOmitConfig = {
    guestSession?: GuestSessionOmit
    roomState?: RoomStateOmit
    playlist?: PlaylistOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type CheckIsLogLevel<T> = T extends LogLevel ? T : never;

  export type GetLogType<T> = CheckIsLogLevel<
    T extends LogDefinition ? T['level'] : T
  >;

  export type GetEvents<T extends any[]> = T extends Array<LogLevel | LogDefinition>
    ? GetLogType<T[number]>
    : never;

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */



  /**
   * Models
   */

  /**
   * Model GuestSession
   */

  export type AggregateGuestSession = {
    _count: GuestSessionCountAggregateOutputType | null
    _min: GuestSessionMinAggregateOutputType | null
    _max: GuestSessionMaxAggregateOutputType | null
  }

  export type GuestSessionMinAggregateOutputType = {
    id: string | null
    nickname: string | null
    token: string | null
    createdAt: Date | null
  }

  export type GuestSessionMaxAggregateOutputType = {
    id: string | null
    nickname: string | null
    token: string | null
    createdAt: Date | null
  }

  export type GuestSessionCountAggregateOutputType = {
    id: number
    nickname: number
    token: number
    createdAt: number
    _all: number
  }


  export type GuestSessionMinAggregateInputType = {
    id?: true
    nickname?: true
    token?: true
    createdAt?: true
  }

  export type GuestSessionMaxAggregateInputType = {
    id?: true
    nickname?: true
    token?: true
    createdAt?: true
  }

  export type GuestSessionCountAggregateInputType = {
    id?: true
    nickname?: true
    token?: true
    createdAt?: true
    _all?: true
  }

  export type GuestSessionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GuestSession to aggregate.
     */
    where?: GuestSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GuestSessions to fetch.
     */
    orderBy?: GuestSessionOrderByWithRelationInput | GuestSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: GuestSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GuestSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GuestSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned GuestSessions
    **/
    _count?: true | GuestSessionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: GuestSessionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: GuestSessionMaxAggregateInputType
  }

  export type GetGuestSessionAggregateType<T extends GuestSessionAggregateArgs> = {
        [P in keyof T & keyof AggregateGuestSession]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateGuestSession[P]>
      : GetScalarType<T[P], AggregateGuestSession[P]>
  }




  export type GuestSessionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: GuestSessionWhereInput
    orderBy?: GuestSessionOrderByWithAggregationInput | GuestSessionOrderByWithAggregationInput[]
    by: GuestSessionScalarFieldEnum[] | GuestSessionScalarFieldEnum
    having?: GuestSessionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: GuestSessionCountAggregateInputType | true
    _min?: GuestSessionMinAggregateInputType
    _max?: GuestSessionMaxAggregateInputType
  }

  export type GuestSessionGroupByOutputType = {
    id: string
    nickname: string
    token: string
    createdAt: Date
    _count: GuestSessionCountAggregateOutputType | null
    _min: GuestSessionMinAggregateOutputType | null
    _max: GuestSessionMaxAggregateOutputType | null
  }

  type GetGuestSessionGroupByPayload<T extends GuestSessionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<GuestSessionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof GuestSessionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], GuestSessionGroupByOutputType[P]>
            : GetScalarType<T[P], GuestSessionGroupByOutputType[P]>
        }
      >
    >


  export type GuestSessionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    nickname?: boolean
    token?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["guestSession"]>

  export type GuestSessionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    nickname?: boolean
    token?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["guestSession"]>

  export type GuestSessionSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    nickname?: boolean
    token?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["guestSession"]>

  export type GuestSessionSelectScalar = {
    id?: boolean
    nickname?: boolean
    token?: boolean
    createdAt?: boolean
  }

  export type GuestSessionOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "nickname" | "token" | "createdAt", ExtArgs["result"]["guestSession"]>

  export type $GuestSessionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "GuestSession"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      nickname: string
      token: string
      createdAt: Date
    }, ExtArgs["result"]["guestSession"]>
    composites: {}
  }

  type GuestSessionGetPayload<S extends boolean | null | undefined | GuestSessionDefaultArgs> = $Result.GetResult<Prisma.$GuestSessionPayload, S>

  type GuestSessionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<GuestSessionFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: GuestSessionCountAggregateInputType | true
    }

  export interface GuestSessionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['GuestSession'], meta: { name: 'GuestSession' } }
    /**
     * Find zero or one GuestSession that matches the filter.
     * @param {GuestSessionFindUniqueArgs} args - Arguments to find a GuestSession
     * @example
     * // Get one GuestSession
     * const guestSession = await prisma.guestSession.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends GuestSessionFindUniqueArgs>(args: SelectSubset<T, GuestSessionFindUniqueArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one GuestSession that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {GuestSessionFindUniqueOrThrowArgs} args - Arguments to find a GuestSession
     * @example
     * // Get one GuestSession
     * const guestSession = await prisma.guestSession.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends GuestSessionFindUniqueOrThrowArgs>(args: SelectSubset<T, GuestSessionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first GuestSession that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GuestSessionFindFirstArgs} args - Arguments to find a GuestSession
     * @example
     * // Get one GuestSession
     * const guestSession = await prisma.guestSession.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends GuestSessionFindFirstArgs>(args?: SelectSubset<T, GuestSessionFindFirstArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first GuestSession that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GuestSessionFindFirstOrThrowArgs} args - Arguments to find a GuestSession
     * @example
     * // Get one GuestSession
     * const guestSession = await prisma.guestSession.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends GuestSessionFindFirstOrThrowArgs>(args?: SelectSubset<T, GuestSessionFindFirstOrThrowArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more GuestSessions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GuestSessionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all GuestSessions
     * const guestSessions = await prisma.guestSession.findMany()
     * 
     * // Get first 10 GuestSessions
     * const guestSessions = await prisma.guestSession.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const guestSessionWithIdOnly = await prisma.guestSession.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends GuestSessionFindManyArgs>(args?: SelectSubset<T, GuestSessionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a GuestSession.
     * @param {GuestSessionCreateArgs} args - Arguments to create a GuestSession.
     * @example
     * // Create one GuestSession
     * const GuestSession = await prisma.guestSession.create({
     *   data: {
     *     // ... data to create a GuestSession
     *   }
     * })
     * 
     */
    create<T extends GuestSessionCreateArgs>(args: SelectSubset<T, GuestSessionCreateArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many GuestSessions.
     * @param {GuestSessionCreateManyArgs} args - Arguments to create many GuestSessions.
     * @example
     * // Create many GuestSessions
     * const guestSession = await prisma.guestSession.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends GuestSessionCreateManyArgs>(args?: SelectSubset<T, GuestSessionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many GuestSessions and returns the data saved in the database.
     * @param {GuestSessionCreateManyAndReturnArgs} args - Arguments to create many GuestSessions.
     * @example
     * // Create many GuestSessions
     * const guestSession = await prisma.guestSession.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many GuestSessions and only return the `id`
     * const guestSessionWithIdOnly = await prisma.guestSession.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends GuestSessionCreateManyAndReturnArgs>(args?: SelectSubset<T, GuestSessionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a GuestSession.
     * @param {GuestSessionDeleteArgs} args - Arguments to delete one GuestSession.
     * @example
     * // Delete one GuestSession
     * const GuestSession = await prisma.guestSession.delete({
     *   where: {
     *     // ... filter to delete one GuestSession
     *   }
     * })
     * 
     */
    delete<T extends GuestSessionDeleteArgs>(args: SelectSubset<T, GuestSessionDeleteArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one GuestSession.
     * @param {GuestSessionUpdateArgs} args - Arguments to update one GuestSession.
     * @example
     * // Update one GuestSession
     * const guestSession = await prisma.guestSession.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends GuestSessionUpdateArgs>(args: SelectSubset<T, GuestSessionUpdateArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more GuestSessions.
     * @param {GuestSessionDeleteManyArgs} args - Arguments to filter GuestSessions to delete.
     * @example
     * // Delete a few GuestSessions
     * const { count } = await prisma.guestSession.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends GuestSessionDeleteManyArgs>(args?: SelectSubset<T, GuestSessionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GuestSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GuestSessionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many GuestSessions
     * const guestSession = await prisma.guestSession.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends GuestSessionUpdateManyArgs>(args: SelectSubset<T, GuestSessionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more GuestSessions and returns the data updated in the database.
     * @param {GuestSessionUpdateManyAndReturnArgs} args - Arguments to update many GuestSessions.
     * @example
     * // Update many GuestSessions
     * const guestSession = await prisma.guestSession.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more GuestSessions and only return the `id`
     * const guestSessionWithIdOnly = await prisma.guestSession.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends GuestSessionUpdateManyAndReturnArgs>(args: SelectSubset<T, GuestSessionUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one GuestSession.
     * @param {GuestSessionUpsertArgs} args - Arguments to update or create a GuestSession.
     * @example
     * // Update or create a GuestSession
     * const guestSession = await prisma.guestSession.upsert({
     *   create: {
     *     // ... data to create a GuestSession
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the GuestSession we want to update
     *   }
     * })
     */
    upsert<T extends GuestSessionUpsertArgs>(args: SelectSubset<T, GuestSessionUpsertArgs<ExtArgs>>): Prisma__GuestSessionClient<$Result.GetResult<Prisma.$GuestSessionPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of GuestSessions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GuestSessionCountArgs} args - Arguments to filter GuestSessions to count.
     * @example
     * // Count the number of GuestSessions
     * const count = await prisma.guestSession.count({
     *   where: {
     *     // ... the filter for the GuestSessions we want to count
     *   }
     * })
    **/
    count<T extends GuestSessionCountArgs>(
      args?: Subset<T, GuestSessionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], GuestSessionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a GuestSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GuestSessionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends GuestSessionAggregateArgs>(args: Subset<T, GuestSessionAggregateArgs>): Prisma.PrismaPromise<GetGuestSessionAggregateType<T>>

    /**
     * Group by GuestSession.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {GuestSessionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends GuestSessionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: GuestSessionGroupByArgs['orderBy'] }
        : { orderBy?: GuestSessionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, GuestSessionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetGuestSessionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the GuestSession model
   */
  readonly fields: GuestSessionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for GuestSession.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__GuestSessionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the GuestSession model
   */
  interface GuestSessionFieldRefs {
    readonly id: FieldRef<"GuestSession", 'String'>
    readonly nickname: FieldRef<"GuestSession", 'String'>
    readonly token: FieldRef<"GuestSession", 'String'>
    readonly createdAt: FieldRef<"GuestSession", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * GuestSession findUnique
   */
  export type GuestSessionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * Filter, which GuestSession to fetch.
     */
    where: GuestSessionWhereUniqueInput
  }

  /**
   * GuestSession findUniqueOrThrow
   */
  export type GuestSessionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * Filter, which GuestSession to fetch.
     */
    where: GuestSessionWhereUniqueInput
  }

  /**
   * GuestSession findFirst
   */
  export type GuestSessionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * Filter, which GuestSession to fetch.
     */
    where?: GuestSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GuestSessions to fetch.
     */
    orderBy?: GuestSessionOrderByWithRelationInput | GuestSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GuestSessions.
     */
    cursor?: GuestSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GuestSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GuestSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GuestSessions.
     */
    distinct?: GuestSessionScalarFieldEnum | GuestSessionScalarFieldEnum[]
  }

  /**
   * GuestSession findFirstOrThrow
   */
  export type GuestSessionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * Filter, which GuestSession to fetch.
     */
    where?: GuestSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GuestSessions to fetch.
     */
    orderBy?: GuestSessionOrderByWithRelationInput | GuestSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for GuestSessions.
     */
    cursor?: GuestSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GuestSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GuestSessions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of GuestSessions.
     */
    distinct?: GuestSessionScalarFieldEnum | GuestSessionScalarFieldEnum[]
  }

  /**
   * GuestSession findMany
   */
  export type GuestSessionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * Filter, which GuestSessions to fetch.
     */
    where?: GuestSessionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of GuestSessions to fetch.
     */
    orderBy?: GuestSessionOrderByWithRelationInput | GuestSessionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing GuestSessions.
     */
    cursor?: GuestSessionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` GuestSessions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` GuestSessions.
     */
    skip?: number
    distinct?: GuestSessionScalarFieldEnum | GuestSessionScalarFieldEnum[]
  }

  /**
   * GuestSession create
   */
  export type GuestSessionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * The data needed to create a GuestSession.
     */
    data: XOR<GuestSessionCreateInput, GuestSessionUncheckedCreateInput>
  }

  /**
   * GuestSession createMany
   */
  export type GuestSessionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many GuestSessions.
     */
    data: GuestSessionCreateManyInput | GuestSessionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GuestSession createManyAndReturn
   */
  export type GuestSessionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * The data used to create many GuestSessions.
     */
    data: GuestSessionCreateManyInput | GuestSessionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * GuestSession update
   */
  export type GuestSessionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * The data needed to update a GuestSession.
     */
    data: XOR<GuestSessionUpdateInput, GuestSessionUncheckedUpdateInput>
    /**
     * Choose, which GuestSession to update.
     */
    where: GuestSessionWhereUniqueInput
  }

  /**
   * GuestSession updateMany
   */
  export type GuestSessionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update GuestSessions.
     */
    data: XOR<GuestSessionUpdateManyMutationInput, GuestSessionUncheckedUpdateManyInput>
    /**
     * Filter which GuestSessions to update
     */
    where?: GuestSessionWhereInput
    /**
     * Limit how many GuestSessions to update.
     */
    limit?: number
  }

  /**
   * GuestSession updateManyAndReturn
   */
  export type GuestSessionUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * The data used to update GuestSessions.
     */
    data: XOR<GuestSessionUpdateManyMutationInput, GuestSessionUncheckedUpdateManyInput>
    /**
     * Filter which GuestSessions to update
     */
    where?: GuestSessionWhereInput
    /**
     * Limit how many GuestSessions to update.
     */
    limit?: number
  }

  /**
   * GuestSession upsert
   */
  export type GuestSessionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * The filter to search for the GuestSession to update in case it exists.
     */
    where: GuestSessionWhereUniqueInput
    /**
     * In case the GuestSession found by the `where` argument doesn't exist, create a new GuestSession with this data.
     */
    create: XOR<GuestSessionCreateInput, GuestSessionUncheckedCreateInput>
    /**
     * In case the GuestSession was found with the provided `where` argument, update it with this data.
     */
    update: XOR<GuestSessionUpdateInput, GuestSessionUncheckedUpdateInput>
  }

  /**
   * GuestSession delete
   */
  export type GuestSessionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
    /**
     * Filter which GuestSession to delete.
     */
    where: GuestSessionWhereUniqueInput
  }

  /**
   * GuestSession deleteMany
   */
  export type GuestSessionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which GuestSessions to delete
     */
    where?: GuestSessionWhereInput
    /**
     * Limit how many GuestSessions to delete.
     */
    limit?: number
  }

  /**
   * GuestSession without action
   */
  export type GuestSessionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the GuestSession
     */
    select?: GuestSessionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the GuestSession
     */
    omit?: GuestSessionOmit<ExtArgs> | null
  }


  /**
   * Model RoomState
   */

  export type AggregateRoomState = {
    _count: RoomStateCountAggregateOutputType | null
    _min: RoomStateMinAggregateOutputType | null
    _max: RoomStateMaxAggregateOutputType | null
  }

  export type RoomStateMinAggregateOutputType = {
    id: string | null
    hostId: string | null
    joinCode: string | null
    visibility: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type RoomStateMaxAggregateOutputType = {
    id: string | null
    hostId: string | null
    joinCode: string | null
    visibility: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type RoomStateCountAggregateOutputType = {
    id: number
    hostId: number
    joinCode: number
    visibility: number
    playback: number
    members: number
    tracks: number
    queue: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type RoomStateMinAggregateInputType = {
    id?: true
    hostId?: true
    joinCode?: true
    visibility?: true
    createdAt?: true
    updatedAt?: true
  }

  export type RoomStateMaxAggregateInputType = {
    id?: true
    hostId?: true
    joinCode?: true
    visibility?: true
    createdAt?: true
    updatedAt?: true
  }

  export type RoomStateCountAggregateInputType = {
    id?: true
    hostId?: true
    joinCode?: true
    visibility?: true
    playback?: true
    members?: true
    tracks?: true
    queue?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type RoomStateAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RoomState to aggregate.
     */
    where?: RoomStateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RoomStates to fetch.
     */
    orderBy?: RoomStateOrderByWithRelationInput | RoomStateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: RoomStateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RoomStates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RoomStates.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned RoomStates
    **/
    _count?: true | RoomStateCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RoomStateMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RoomStateMaxAggregateInputType
  }

  export type GetRoomStateAggregateType<T extends RoomStateAggregateArgs> = {
        [P in keyof T & keyof AggregateRoomState]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRoomState[P]>
      : GetScalarType<T[P], AggregateRoomState[P]>
  }




  export type RoomStateGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RoomStateWhereInput
    orderBy?: RoomStateOrderByWithAggregationInput | RoomStateOrderByWithAggregationInput[]
    by: RoomStateScalarFieldEnum[] | RoomStateScalarFieldEnum
    having?: RoomStateScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RoomStateCountAggregateInputType | true
    _min?: RoomStateMinAggregateInputType
    _max?: RoomStateMaxAggregateInputType
  }

  export type RoomStateGroupByOutputType = {
    id: string
    hostId: string
    joinCode: string
    visibility: string
    playback: JsonValue
    members: JsonValue
    tracks: JsonValue
    queue: JsonValue
    createdAt: Date
    updatedAt: Date
    _count: RoomStateCountAggregateOutputType | null
    _min: RoomStateMinAggregateOutputType | null
    _max: RoomStateMaxAggregateOutputType | null
  }

  type GetRoomStateGroupByPayload<T extends RoomStateGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RoomStateGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RoomStateGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RoomStateGroupByOutputType[P]>
            : GetScalarType<T[P], RoomStateGroupByOutputType[P]>
        }
      >
    >


  export type RoomStateSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    hostId?: boolean
    joinCode?: boolean
    visibility?: boolean
    playback?: boolean
    members?: boolean
    tracks?: boolean
    queue?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["roomState"]>

  export type RoomStateSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    hostId?: boolean
    joinCode?: boolean
    visibility?: boolean
    playback?: boolean
    members?: boolean
    tracks?: boolean
    queue?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["roomState"]>

  export type RoomStateSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    hostId?: boolean
    joinCode?: boolean
    visibility?: boolean
    playback?: boolean
    members?: boolean
    tracks?: boolean
    queue?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["roomState"]>

  export type RoomStateSelectScalar = {
    id?: boolean
    hostId?: boolean
    joinCode?: boolean
    visibility?: boolean
    playback?: boolean
    members?: boolean
    tracks?: boolean
    queue?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type RoomStateOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "hostId" | "joinCode" | "visibility" | "playback" | "members" | "tracks" | "queue" | "createdAt" | "updatedAt", ExtArgs["result"]["roomState"]>

  export type $RoomStatePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "RoomState"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      hostId: string
      joinCode: string
      visibility: string
      playback: Prisma.JsonValue
      members: Prisma.JsonValue
      tracks: Prisma.JsonValue
      queue: Prisma.JsonValue
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["roomState"]>
    composites: {}
  }

  type RoomStateGetPayload<S extends boolean | null | undefined | RoomStateDefaultArgs> = $Result.GetResult<Prisma.$RoomStatePayload, S>

  type RoomStateCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<RoomStateFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: RoomStateCountAggregateInputType | true
    }

  export interface RoomStateDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['RoomState'], meta: { name: 'RoomState' } }
    /**
     * Find zero or one RoomState that matches the filter.
     * @param {RoomStateFindUniqueArgs} args - Arguments to find a RoomState
     * @example
     * // Get one RoomState
     * const roomState = await prisma.roomState.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends RoomStateFindUniqueArgs>(args: SelectSubset<T, RoomStateFindUniqueArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one RoomState that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {RoomStateFindUniqueOrThrowArgs} args - Arguments to find a RoomState
     * @example
     * // Get one RoomState
     * const roomState = await prisma.roomState.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends RoomStateFindUniqueOrThrowArgs>(args: SelectSubset<T, RoomStateFindUniqueOrThrowArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RoomState that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RoomStateFindFirstArgs} args - Arguments to find a RoomState
     * @example
     * // Get one RoomState
     * const roomState = await prisma.roomState.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends RoomStateFindFirstArgs>(args?: SelectSubset<T, RoomStateFindFirstArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first RoomState that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RoomStateFindFirstOrThrowArgs} args - Arguments to find a RoomState
     * @example
     * // Get one RoomState
     * const roomState = await prisma.roomState.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends RoomStateFindFirstOrThrowArgs>(args?: SelectSubset<T, RoomStateFindFirstOrThrowArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more RoomStates that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RoomStateFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all RoomStates
     * const roomStates = await prisma.roomState.findMany()
     * 
     * // Get first 10 RoomStates
     * const roomStates = await prisma.roomState.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const roomStateWithIdOnly = await prisma.roomState.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends RoomStateFindManyArgs>(args?: SelectSubset<T, RoomStateFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a RoomState.
     * @param {RoomStateCreateArgs} args - Arguments to create a RoomState.
     * @example
     * // Create one RoomState
     * const RoomState = await prisma.roomState.create({
     *   data: {
     *     // ... data to create a RoomState
     *   }
     * })
     * 
     */
    create<T extends RoomStateCreateArgs>(args: SelectSubset<T, RoomStateCreateArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many RoomStates.
     * @param {RoomStateCreateManyArgs} args - Arguments to create many RoomStates.
     * @example
     * // Create many RoomStates
     * const roomState = await prisma.roomState.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends RoomStateCreateManyArgs>(args?: SelectSubset<T, RoomStateCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many RoomStates and returns the data saved in the database.
     * @param {RoomStateCreateManyAndReturnArgs} args - Arguments to create many RoomStates.
     * @example
     * // Create many RoomStates
     * const roomState = await prisma.roomState.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many RoomStates and only return the `id`
     * const roomStateWithIdOnly = await prisma.roomState.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends RoomStateCreateManyAndReturnArgs>(args?: SelectSubset<T, RoomStateCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a RoomState.
     * @param {RoomStateDeleteArgs} args - Arguments to delete one RoomState.
     * @example
     * // Delete one RoomState
     * const RoomState = await prisma.roomState.delete({
     *   where: {
     *     // ... filter to delete one RoomState
     *   }
     * })
     * 
     */
    delete<T extends RoomStateDeleteArgs>(args: SelectSubset<T, RoomStateDeleteArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one RoomState.
     * @param {RoomStateUpdateArgs} args - Arguments to update one RoomState.
     * @example
     * // Update one RoomState
     * const roomState = await prisma.roomState.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends RoomStateUpdateArgs>(args: SelectSubset<T, RoomStateUpdateArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more RoomStates.
     * @param {RoomStateDeleteManyArgs} args - Arguments to filter RoomStates to delete.
     * @example
     * // Delete a few RoomStates
     * const { count } = await prisma.roomState.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends RoomStateDeleteManyArgs>(args?: SelectSubset<T, RoomStateDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RoomStates.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RoomStateUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many RoomStates
     * const roomState = await prisma.roomState.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends RoomStateUpdateManyArgs>(args: SelectSubset<T, RoomStateUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RoomStates and returns the data updated in the database.
     * @param {RoomStateUpdateManyAndReturnArgs} args - Arguments to update many RoomStates.
     * @example
     * // Update many RoomStates
     * const roomState = await prisma.roomState.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more RoomStates and only return the `id`
     * const roomStateWithIdOnly = await prisma.roomState.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends RoomStateUpdateManyAndReturnArgs>(args: SelectSubset<T, RoomStateUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one RoomState.
     * @param {RoomStateUpsertArgs} args - Arguments to update or create a RoomState.
     * @example
     * // Update or create a RoomState
     * const roomState = await prisma.roomState.upsert({
     *   create: {
     *     // ... data to create a RoomState
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the RoomState we want to update
     *   }
     * })
     */
    upsert<T extends RoomStateUpsertArgs>(args: SelectSubset<T, RoomStateUpsertArgs<ExtArgs>>): Prisma__RoomStateClient<$Result.GetResult<Prisma.$RoomStatePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of RoomStates.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RoomStateCountArgs} args - Arguments to filter RoomStates to count.
     * @example
     * // Count the number of RoomStates
     * const count = await prisma.roomState.count({
     *   where: {
     *     // ... the filter for the RoomStates we want to count
     *   }
     * })
    **/
    count<T extends RoomStateCountArgs>(
      args?: Subset<T, RoomStateCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RoomStateCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a RoomState.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RoomStateAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends RoomStateAggregateArgs>(args: Subset<T, RoomStateAggregateArgs>): Prisma.PrismaPromise<GetRoomStateAggregateType<T>>

    /**
     * Group by RoomState.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RoomStateGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends RoomStateGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RoomStateGroupByArgs['orderBy'] }
        : { orderBy?: RoomStateGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, RoomStateGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRoomStateGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the RoomState model
   */
  readonly fields: RoomStateFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for RoomState.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__RoomStateClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the RoomState model
   */
  interface RoomStateFieldRefs {
    readonly id: FieldRef<"RoomState", 'String'>
    readonly hostId: FieldRef<"RoomState", 'String'>
    readonly joinCode: FieldRef<"RoomState", 'String'>
    readonly visibility: FieldRef<"RoomState", 'String'>
    readonly playback: FieldRef<"RoomState", 'Json'>
    readonly members: FieldRef<"RoomState", 'Json'>
    readonly tracks: FieldRef<"RoomState", 'Json'>
    readonly queue: FieldRef<"RoomState", 'Json'>
    readonly createdAt: FieldRef<"RoomState", 'DateTime'>
    readonly updatedAt: FieldRef<"RoomState", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * RoomState findUnique
   */
  export type RoomStateFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * Filter, which RoomState to fetch.
     */
    where: RoomStateWhereUniqueInput
  }

  /**
   * RoomState findUniqueOrThrow
   */
  export type RoomStateFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * Filter, which RoomState to fetch.
     */
    where: RoomStateWhereUniqueInput
  }

  /**
   * RoomState findFirst
   */
  export type RoomStateFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * Filter, which RoomState to fetch.
     */
    where?: RoomStateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RoomStates to fetch.
     */
    orderBy?: RoomStateOrderByWithRelationInput | RoomStateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RoomStates.
     */
    cursor?: RoomStateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RoomStates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RoomStates.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RoomStates.
     */
    distinct?: RoomStateScalarFieldEnum | RoomStateScalarFieldEnum[]
  }

  /**
   * RoomState findFirstOrThrow
   */
  export type RoomStateFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * Filter, which RoomState to fetch.
     */
    where?: RoomStateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RoomStates to fetch.
     */
    orderBy?: RoomStateOrderByWithRelationInput | RoomStateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RoomStates.
     */
    cursor?: RoomStateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RoomStates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RoomStates.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RoomStates.
     */
    distinct?: RoomStateScalarFieldEnum | RoomStateScalarFieldEnum[]
  }

  /**
   * RoomState findMany
   */
  export type RoomStateFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * Filter, which RoomStates to fetch.
     */
    where?: RoomStateWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RoomStates to fetch.
     */
    orderBy?: RoomStateOrderByWithRelationInput | RoomStateOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing RoomStates.
     */
    cursor?: RoomStateWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RoomStates from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RoomStates.
     */
    skip?: number
    distinct?: RoomStateScalarFieldEnum | RoomStateScalarFieldEnum[]
  }

  /**
   * RoomState create
   */
  export type RoomStateCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * The data needed to create a RoomState.
     */
    data: XOR<RoomStateCreateInput, RoomStateUncheckedCreateInput>
  }

  /**
   * RoomState createMany
   */
  export type RoomStateCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many RoomStates.
     */
    data: RoomStateCreateManyInput | RoomStateCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RoomState createManyAndReturn
   */
  export type RoomStateCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * The data used to create many RoomStates.
     */
    data: RoomStateCreateManyInput | RoomStateCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RoomState update
   */
  export type RoomStateUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * The data needed to update a RoomState.
     */
    data: XOR<RoomStateUpdateInput, RoomStateUncheckedUpdateInput>
    /**
     * Choose, which RoomState to update.
     */
    where: RoomStateWhereUniqueInput
  }

  /**
   * RoomState updateMany
   */
  export type RoomStateUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update RoomStates.
     */
    data: XOR<RoomStateUpdateManyMutationInput, RoomStateUncheckedUpdateManyInput>
    /**
     * Filter which RoomStates to update
     */
    where?: RoomStateWhereInput
    /**
     * Limit how many RoomStates to update.
     */
    limit?: number
  }

  /**
   * RoomState updateManyAndReturn
   */
  export type RoomStateUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * The data used to update RoomStates.
     */
    data: XOR<RoomStateUpdateManyMutationInput, RoomStateUncheckedUpdateManyInput>
    /**
     * Filter which RoomStates to update
     */
    where?: RoomStateWhereInput
    /**
     * Limit how many RoomStates to update.
     */
    limit?: number
  }

  /**
   * RoomState upsert
   */
  export type RoomStateUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * The filter to search for the RoomState to update in case it exists.
     */
    where: RoomStateWhereUniqueInput
    /**
     * In case the RoomState found by the `where` argument doesn't exist, create a new RoomState with this data.
     */
    create: XOR<RoomStateCreateInput, RoomStateUncheckedCreateInput>
    /**
     * In case the RoomState was found with the provided `where` argument, update it with this data.
     */
    update: XOR<RoomStateUpdateInput, RoomStateUncheckedUpdateInput>
  }

  /**
   * RoomState delete
   */
  export type RoomStateDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
    /**
     * Filter which RoomState to delete.
     */
    where: RoomStateWhereUniqueInput
  }

  /**
   * RoomState deleteMany
   */
  export type RoomStateDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RoomStates to delete
     */
    where?: RoomStateWhereInput
    /**
     * Limit how many RoomStates to delete.
     */
    limit?: number
  }

  /**
   * RoomState without action
   */
  export type RoomStateDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RoomState
     */
    select?: RoomStateSelect<ExtArgs> | null
    /**
     * Omit specific fields from the RoomState
     */
    omit?: RoomStateOmit<ExtArgs> | null
  }


  /**
   * Model Playlist
   */

  export type AggregatePlaylist = {
    _count: PlaylistCountAggregateOutputType | null
    _min: PlaylistMinAggregateOutputType | null
    _max: PlaylistMaxAggregateOutputType | null
  }

  export type PlaylistMinAggregateOutputType = {
    id: string | null
    ownerId: string | null
    roomId: string | null
    title: string | null
    description: string | null
    coverUrl: string | null
    isCollaborative: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PlaylistMaxAggregateOutputType = {
    id: string | null
    ownerId: string | null
    roomId: string | null
    title: string | null
    description: string | null
    coverUrl: string | null
    isCollaborative: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PlaylistCountAggregateOutputType = {
    id: number
    ownerId: number
    roomId: number
    title: number
    description: number
    coverUrl: number
    tags: number
    isCollaborative: number
    trackIds: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PlaylistMinAggregateInputType = {
    id?: true
    ownerId?: true
    roomId?: true
    title?: true
    description?: true
    coverUrl?: true
    isCollaborative?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PlaylistMaxAggregateInputType = {
    id?: true
    ownerId?: true
    roomId?: true
    title?: true
    description?: true
    coverUrl?: true
    isCollaborative?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PlaylistCountAggregateInputType = {
    id?: true
    ownerId?: true
    roomId?: true
    title?: true
    description?: true
    coverUrl?: true
    tags?: true
    isCollaborative?: true
    trackIds?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PlaylistAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Playlist to aggregate.
     */
    where?: PlaylistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Playlists to fetch.
     */
    orderBy?: PlaylistOrderByWithRelationInput | PlaylistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PlaylistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Playlists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Playlists.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Playlists
    **/
    _count?: true | PlaylistCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PlaylistMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PlaylistMaxAggregateInputType
  }

  export type GetPlaylistAggregateType<T extends PlaylistAggregateArgs> = {
        [P in keyof T & keyof AggregatePlaylist]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePlaylist[P]>
      : GetScalarType<T[P], AggregatePlaylist[P]>
  }




  export type PlaylistGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PlaylistWhereInput
    orderBy?: PlaylistOrderByWithAggregationInput | PlaylistOrderByWithAggregationInput[]
    by: PlaylistScalarFieldEnum[] | PlaylistScalarFieldEnum
    having?: PlaylistScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PlaylistCountAggregateInputType | true
    _min?: PlaylistMinAggregateInputType
    _max?: PlaylistMaxAggregateInputType
  }

  export type PlaylistGroupByOutputType = {
    id: string
    ownerId: string
    roomId: string | null
    title: string
    description: string | null
    coverUrl: string | null
    tags: JsonValue
    isCollaborative: boolean
    trackIds: JsonValue
    createdAt: Date
    updatedAt: Date
    _count: PlaylistCountAggregateOutputType | null
    _min: PlaylistMinAggregateOutputType | null
    _max: PlaylistMaxAggregateOutputType | null
  }

  type GetPlaylistGroupByPayload<T extends PlaylistGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PlaylistGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PlaylistGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PlaylistGroupByOutputType[P]>
            : GetScalarType<T[P], PlaylistGroupByOutputType[P]>
        }
      >
    >


  export type PlaylistSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    ownerId?: boolean
    roomId?: boolean
    title?: boolean
    description?: boolean
    coverUrl?: boolean
    tags?: boolean
    isCollaborative?: boolean
    trackIds?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["playlist"]>

  export type PlaylistSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    ownerId?: boolean
    roomId?: boolean
    title?: boolean
    description?: boolean
    coverUrl?: boolean
    tags?: boolean
    isCollaborative?: boolean
    trackIds?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["playlist"]>

  export type PlaylistSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    ownerId?: boolean
    roomId?: boolean
    title?: boolean
    description?: boolean
    coverUrl?: boolean
    tags?: boolean
    isCollaborative?: boolean
    trackIds?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["playlist"]>

  export type PlaylistSelectScalar = {
    id?: boolean
    ownerId?: boolean
    roomId?: boolean
    title?: boolean
    description?: boolean
    coverUrl?: boolean
    tags?: boolean
    isCollaborative?: boolean
    trackIds?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PlaylistOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "ownerId" | "roomId" | "title" | "description" | "coverUrl" | "tags" | "isCollaborative" | "trackIds" | "createdAt" | "updatedAt", ExtArgs["result"]["playlist"]>

  export type $PlaylistPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Playlist"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      ownerId: string
      roomId: string | null
      title: string
      description: string | null
      coverUrl: string | null
      tags: Prisma.JsonValue
      isCollaborative: boolean
      trackIds: Prisma.JsonValue
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["playlist"]>
    composites: {}
  }

  type PlaylistGetPayload<S extends boolean | null | undefined | PlaylistDefaultArgs> = $Result.GetResult<Prisma.$PlaylistPayload, S>

  type PlaylistCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PlaylistFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PlaylistCountAggregateInputType | true
    }

  export interface PlaylistDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Playlist'], meta: { name: 'Playlist' } }
    /**
     * Find zero or one Playlist that matches the filter.
     * @param {PlaylistFindUniqueArgs} args - Arguments to find a Playlist
     * @example
     * // Get one Playlist
     * const playlist = await prisma.playlist.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PlaylistFindUniqueArgs>(args: SelectSubset<T, PlaylistFindUniqueArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Playlist that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PlaylistFindUniqueOrThrowArgs} args - Arguments to find a Playlist
     * @example
     * // Get one Playlist
     * const playlist = await prisma.playlist.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PlaylistFindUniqueOrThrowArgs>(args: SelectSubset<T, PlaylistFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Playlist that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlaylistFindFirstArgs} args - Arguments to find a Playlist
     * @example
     * // Get one Playlist
     * const playlist = await prisma.playlist.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PlaylistFindFirstArgs>(args?: SelectSubset<T, PlaylistFindFirstArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Playlist that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlaylistFindFirstOrThrowArgs} args - Arguments to find a Playlist
     * @example
     * // Get one Playlist
     * const playlist = await prisma.playlist.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PlaylistFindFirstOrThrowArgs>(args?: SelectSubset<T, PlaylistFindFirstOrThrowArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Playlists that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlaylistFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Playlists
     * const playlists = await prisma.playlist.findMany()
     * 
     * // Get first 10 Playlists
     * const playlists = await prisma.playlist.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const playlistWithIdOnly = await prisma.playlist.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PlaylistFindManyArgs>(args?: SelectSubset<T, PlaylistFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Playlist.
     * @param {PlaylistCreateArgs} args - Arguments to create a Playlist.
     * @example
     * // Create one Playlist
     * const Playlist = await prisma.playlist.create({
     *   data: {
     *     // ... data to create a Playlist
     *   }
     * })
     * 
     */
    create<T extends PlaylistCreateArgs>(args: SelectSubset<T, PlaylistCreateArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Playlists.
     * @param {PlaylistCreateManyArgs} args - Arguments to create many Playlists.
     * @example
     * // Create many Playlists
     * const playlist = await prisma.playlist.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PlaylistCreateManyArgs>(args?: SelectSubset<T, PlaylistCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Playlists and returns the data saved in the database.
     * @param {PlaylistCreateManyAndReturnArgs} args - Arguments to create many Playlists.
     * @example
     * // Create many Playlists
     * const playlist = await prisma.playlist.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Playlists and only return the `id`
     * const playlistWithIdOnly = await prisma.playlist.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PlaylistCreateManyAndReturnArgs>(args?: SelectSubset<T, PlaylistCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Playlist.
     * @param {PlaylistDeleteArgs} args - Arguments to delete one Playlist.
     * @example
     * // Delete one Playlist
     * const Playlist = await prisma.playlist.delete({
     *   where: {
     *     // ... filter to delete one Playlist
     *   }
     * })
     * 
     */
    delete<T extends PlaylistDeleteArgs>(args: SelectSubset<T, PlaylistDeleteArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Playlist.
     * @param {PlaylistUpdateArgs} args - Arguments to update one Playlist.
     * @example
     * // Update one Playlist
     * const playlist = await prisma.playlist.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PlaylistUpdateArgs>(args: SelectSubset<T, PlaylistUpdateArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Playlists.
     * @param {PlaylistDeleteManyArgs} args - Arguments to filter Playlists to delete.
     * @example
     * // Delete a few Playlists
     * const { count } = await prisma.playlist.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PlaylistDeleteManyArgs>(args?: SelectSubset<T, PlaylistDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Playlists.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlaylistUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Playlists
     * const playlist = await prisma.playlist.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PlaylistUpdateManyArgs>(args: SelectSubset<T, PlaylistUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Playlists and returns the data updated in the database.
     * @param {PlaylistUpdateManyAndReturnArgs} args - Arguments to update many Playlists.
     * @example
     * // Update many Playlists
     * const playlist = await prisma.playlist.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Playlists and only return the `id`
     * const playlistWithIdOnly = await prisma.playlist.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PlaylistUpdateManyAndReturnArgs>(args: SelectSubset<T, PlaylistUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Playlist.
     * @param {PlaylistUpsertArgs} args - Arguments to update or create a Playlist.
     * @example
     * // Update or create a Playlist
     * const playlist = await prisma.playlist.upsert({
     *   create: {
     *     // ... data to create a Playlist
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Playlist we want to update
     *   }
     * })
     */
    upsert<T extends PlaylistUpsertArgs>(args: SelectSubset<T, PlaylistUpsertArgs<ExtArgs>>): Prisma__PlaylistClient<$Result.GetResult<Prisma.$PlaylistPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Playlists.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlaylistCountArgs} args - Arguments to filter Playlists to count.
     * @example
     * // Count the number of Playlists
     * const count = await prisma.playlist.count({
     *   where: {
     *     // ... the filter for the Playlists we want to count
     *   }
     * })
    **/
    count<T extends PlaylistCountArgs>(
      args?: Subset<T, PlaylistCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PlaylistCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Playlist.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlaylistAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PlaylistAggregateArgs>(args: Subset<T, PlaylistAggregateArgs>): Prisma.PrismaPromise<GetPlaylistAggregateType<T>>

    /**
     * Group by Playlist.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PlaylistGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PlaylistGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PlaylistGroupByArgs['orderBy'] }
        : { orderBy?: PlaylistGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PlaylistGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPlaylistGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Playlist model
   */
  readonly fields: PlaylistFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Playlist.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PlaylistClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Playlist model
   */
  interface PlaylistFieldRefs {
    readonly id: FieldRef<"Playlist", 'String'>
    readonly ownerId: FieldRef<"Playlist", 'String'>
    readonly roomId: FieldRef<"Playlist", 'String'>
    readonly title: FieldRef<"Playlist", 'String'>
    readonly description: FieldRef<"Playlist", 'String'>
    readonly coverUrl: FieldRef<"Playlist", 'String'>
    readonly tags: FieldRef<"Playlist", 'Json'>
    readonly isCollaborative: FieldRef<"Playlist", 'Boolean'>
    readonly trackIds: FieldRef<"Playlist", 'Json'>
    readonly createdAt: FieldRef<"Playlist", 'DateTime'>
    readonly updatedAt: FieldRef<"Playlist", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Playlist findUnique
   */
  export type PlaylistFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * Filter, which Playlist to fetch.
     */
    where: PlaylistWhereUniqueInput
  }

  /**
   * Playlist findUniqueOrThrow
   */
  export type PlaylistFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * Filter, which Playlist to fetch.
     */
    where: PlaylistWhereUniqueInput
  }

  /**
   * Playlist findFirst
   */
  export type PlaylistFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * Filter, which Playlist to fetch.
     */
    where?: PlaylistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Playlists to fetch.
     */
    orderBy?: PlaylistOrderByWithRelationInput | PlaylistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Playlists.
     */
    cursor?: PlaylistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Playlists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Playlists.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Playlists.
     */
    distinct?: PlaylistScalarFieldEnum | PlaylistScalarFieldEnum[]
  }

  /**
   * Playlist findFirstOrThrow
   */
  export type PlaylistFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * Filter, which Playlist to fetch.
     */
    where?: PlaylistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Playlists to fetch.
     */
    orderBy?: PlaylistOrderByWithRelationInput | PlaylistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Playlists.
     */
    cursor?: PlaylistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Playlists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Playlists.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Playlists.
     */
    distinct?: PlaylistScalarFieldEnum | PlaylistScalarFieldEnum[]
  }

  /**
   * Playlist findMany
   */
  export type PlaylistFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * Filter, which Playlists to fetch.
     */
    where?: PlaylistWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Playlists to fetch.
     */
    orderBy?: PlaylistOrderByWithRelationInput | PlaylistOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Playlists.
     */
    cursor?: PlaylistWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Playlists from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Playlists.
     */
    skip?: number
    distinct?: PlaylistScalarFieldEnum | PlaylistScalarFieldEnum[]
  }

  /**
   * Playlist create
   */
  export type PlaylistCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * The data needed to create a Playlist.
     */
    data: XOR<PlaylistCreateInput, PlaylistUncheckedCreateInput>
  }

  /**
   * Playlist createMany
   */
  export type PlaylistCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Playlists.
     */
    data: PlaylistCreateManyInput | PlaylistCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Playlist createManyAndReturn
   */
  export type PlaylistCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * The data used to create many Playlists.
     */
    data: PlaylistCreateManyInput | PlaylistCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Playlist update
   */
  export type PlaylistUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * The data needed to update a Playlist.
     */
    data: XOR<PlaylistUpdateInput, PlaylistUncheckedUpdateInput>
    /**
     * Choose, which Playlist to update.
     */
    where: PlaylistWhereUniqueInput
  }

  /**
   * Playlist updateMany
   */
  export type PlaylistUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Playlists.
     */
    data: XOR<PlaylistUpdateManyMutationInput, PlaylistUncheckedUpdateManyInput>
    /**
     * Filter which Playlists to update
     */
    where?: PlaylistWhereInput
    /**
     * Limit how many Playlists to update.
     */
    limit?: number
  }

  /**
   * Playlist updateManyAndReturn
   */
  export type PlaylistUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * The data used to update Playlists.
     */
    data: XOR<PlaylistUpdateManyMutationInput, PlaylistUncheckedUpdateManyInput>
    /**
     * Filter which Playlists to update
     */
    where?: PlaylistWhereInput
    /**
     * Limit how many Playlists to update.
     */
    limit?: number
  }

  /**
   * Playlist upsert
   */
  export type PlaylistUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * The filter to search for the Playlist to update in case it exists.
     */
    where: PlaylistWhereUniqueInput
    /**
     * In case the Playlist found by the `where` argument doesn't exist, create a new Playlist with this data.
     */
    create: XOR<PlaylistCreateInput, PlaylistUncheckedCreateInput>
    /**
     * In case the Playlist was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PlaylistUpdateInput, PlaylistUncheckedUpdateInput>
  }

  /**
   * Playlist delete
   */
  export type PlaylistDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
    /**
     * Filter which Playlist to delete.
     */
    where: PlaylistWhereUniqueInput
  }

  /**
   * Playlist deleteMany
   */
  export type PlaylistDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Playlists to delete
     */
    where?: PlaylistWhereInput
    /**
     * Limit how many Playlists to delete.
     */
    limit?: number
  }

  /**
   * Playlist without action
   */
  export type PlaylistDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Playlist
     */
    select?: PlaylistSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Playlist
     */
    omit?: PlaylistOmit<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const GuestSessionScalarFieldEnum: {
    id: 'id',
    nickname: 'nickname',
    token: 'token',
    createdAt: 'createdAt'
  };

  export type GuestSessionScalarFieldEnum = (typeof GuestSessionScalarFieldEnum)[keyof typeof GuestSessionScalarFieldEnum]


  export const RoomStateScalarFieldEnum: {
    id: 'id',
    hostId: 'hostId',
    joinCode: 'joinCode',
    visibility: 'visibility',
    playback: 'playback',
    members: 'members',
    tracks: 'tracks',
    queue: 'queue',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type RoomStateScalarFieldEnum = (typeof RoomStateScalarFieldEnum)[keyof typeof RoomStateScalarFieldEnum]


  export const PlaylistScalarFieldEnum: {
    id: 'id',
    ownerId: 'ownerId',
    roomId: 'roomId',
    title: 'title',
    description: 'description',
    coverUrl: 'coverUrl',
    tags: 'tags',
    isCollaborative: 'isCollaborative',
    trackIds: 'trackIds',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PlaylistScalarFieldEnum = (typeof PlaylistScalarFieldEnum)[keyof typeof PlaylistScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'QueryMode'
   */
  export type EnumQueryModeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'QueryMode'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    
  /**
   * Deep Input Types
   */


  export type GuestSessionWhereInput = {
    AND?: GuestSessionWhereInput | GuestSessionWhereInput[]
    OR?: GuestSessionWhereInput[]
    NOT?: GuestSessionWhereInput | GuestSessionWhereInput[]
    id?: StringFilter<"GuestSession"> | string
    nickname?: StringFilter<"GuestSession"> | string
    token?: StringFilter<"GuestSession"> | string
    createdAt?: DateTimeFilter<"GuestSession"> | Date | string
  }

  export type GuestSessionOrderByWithRelationInput = {
    id?: SortOrder
    nickname?: SortOrder
    token?: SortOrder
    createdAt?: SortOrder
  }

  export type GuestSessionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: GuestSessionWhereInput | GuestSessionWhereInput[]
    OR?: GuestSessionWhereInput[]
    NOT?: GuestSessionWhereInput | GuestSessionWhereInput[]
    nickname?: StringFilter<"GuestSession"> | string
    token?: StringFilter<"GuestSession"> | string
    createdAt?: DateTimeFilter<"GuestSession"> | Date | string
  }, "id">

  export type GuestSessionOrderByWithAggregationInput = {
    id?: SortOrder
    nickname?: SortOrder
    token?: SortOrder
    createdAt?: SortOrder
    _count?: GuestSessionCountOrderByAggregateInput
    _max?: GuestSessionMaxOrderByAggregateInput
    _min?: GuestSessionMinOrderByAggregateInput
  }

  export type GuestSessionScalarWhereWithAggregatesInput = {
    AND?: GuestSessionScalarWhereWithAggregatesInput | GuestSessionScalarWhereWithAggregatesInput[]
    OR?: GuestSessionScalarWhereWithAggregatesInput[]
    NOT?: GuestSessionScalarWhereWithAggregatesInput | GuestSessionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"GuestSession"> | string
    nickname?: StringWithAggregatesFilter<"GuestSession"> | string
    token?: StringWithAggregatesFilter<"GuestSession"> | string
    createdAt?: DateTimeWithAggregatesFilter<"GuestSession"> | Date | string
  }

  export type RoomStateWhereInput = {
    AND?: RoomStateWhereInput | RoomStateWhereInput[]
    OR?: RoomStateWhereInput[]
    NOT?: RoomStateWhereInput | RoomStateWhereInput[]
    id?: StringFilter<"RoomState"> | string
    hostId?: StringFilter<"RoomState"> | string
    joinCode?: StringFilter<"RoomState"> | string
    visibility?: StringFilter<"RoomState"> | string
    playback?: JsonFilter<"RoomState">
    members?: JsonFilter<"RoomState">
    tracks?: JsonFilter<"RoomState">
    queue?: JsonFilter<"RoomState">
    createdAt?: DateTimeFilter<"RoomState"> | Date | string
    updatedAt?: DateTimeFilter<"RoomState"> | Date | string
  }

  export type RoomStateOrderByWithRelationInput = {
    id?: SortOrder
    hostId?: SortOrder
    joinCode?: SortOrder
    visibility?: SortOrder
    playback?: SortOrder
    members?: SortOrder
    tracks?: SortOrder
    queue?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RoomStateWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    joinCode?: string
    AND?: RoomStateWhereInput | RoomStateWhereInput[]
    OR?: RoomStateWhereInput[]
    NOT?: RoomStateWhereInput | RoomStateWhereInput[]
    hostId?: StringFilter<"RoomState"> | string
    visibility?: StringFilter<"RoomState"> | string
    playback?: JsonFilter<"RoomState">
    members?: JsonFilter<"RoomState">
    tracks?: JsonFilter<"RoomState">
    queue?: JsonFilter<"RoomState">
    createdAt?: DateTimeFilter<"RoomState"> | Date | string
    updatedAt?: DateTimeFilter<"RoomState"> | Date | string
  }, "id" | "joinCode">

  export type RoomStateOrderByWithAggregationInput = {
    id?: SortOrder
    hostId?: SortOrder
    joinCode?: SortOrder
    visibility?: SortOrder
    playback?: SortOrder
    members?: SortOrder
    tracks?: SortOrder
    queue?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: RoomStateCountOrderByAggregateInput
    _max?: RoomStateMaxOrderByAggregateInput
    _min?: RoomStateMinOrderByAggregateInput
  }

  export type RoomStateScalarWhereWithAggregatesInput = {
    AND?: RoomStateScalarWhereWithAggregatesInput | RoomStateScalarWhereWithAggregatesInput[]
    OR?: RoomStateScalarWhereWithAggregatesInput[]
    NOT?: RoomStateScalarWhereWithAggregatesInput | RoomStateScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"RoomState"> | string
    hostId?: StringWithAggregatesFilter<"RoomState"> | string
    joinCode?: StringWithAggregatesFilter<"RoomState"> | string
    visibility?: StringWithAggregatesFilter<"RoomState"> | string
    playback?: JsonWithAggregatesFilter<"RoomState">
    members?: JsonWithAggregatesFilter<"RoomState">
    tracks?: JsonWithAggregatesFilter<"RoomState">
    queue?: JsonWithAggregatesFilter<"RoomState">
    createdAt?: DateTimeWithAggregatesFilter<"RoomState"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"RoomState"> | Date | string
  }

  export type PlaylistWhereInput = {
    AND?: PlaylistWhereInput | PlaylistWhereInput[]
    OR?: PlaylistWhereInput[]
    NOT?: PlaylistWhereInput | PlaylistWhereInput[]
    id?: StringFilter<"Playlist"> | string
    ownerId?: StringFilter<"Playlist"> | string
    roomId?: StringNullableFilter<"Playlist"> | string | null
    title?: StringFilter<"Playlist"> | string
    description?: StringNullableFilter<"Playlist"> | string | null
    coverUrl?: StringNullableFilter<"Playlist"> | string | null
    tags?: JsonFilter<"Playlist">
    isCollaborative?: BoolFilter<"Playlist"> | boolean
    trackIds?: JsonFilter<"Playlist">
    createdAt?: DateTimeFilter<"Playlist"> | Date | string
    updatedAt?: DateTimeFilter<"Playlist"> | Date | string
  }

  export type PlaylistOrderByWithRelationInput = {
    id?: SortOrder
    ownerId?: SortOrder
    roomId?: SortOrderInput | SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    coverUrl?: SortOrderInput | SortOrder
    tags?: SortOrder
    isCollaborative?: SortOrder
    trackIds?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PlaylistWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: PlaylistWhereInput | PlaylistWhereInput[]
    OR?: PlaylistWhereInput[]
    NOT?: PlaylistWhereInput | PlaylistWhereInput[]
    ownerId?: StringFilter<"Playlist"> | string
    roomId?: StringNullableFilter<"Playlist"> | string | null
    title?: StringFilter<"Playlist"> | string
    description?: StringNullableFilter<"Playlist"> | string | null
    coverUrl?: StringNullableFilter<"Playlist"> | string | null
    tags?: JsonFilter<"Playlist">
    isCollaborative?: BoolFilter<"Playlist"> | boolean
    trackIds?: JsonFilter<"Playlist">
    createdAt?: DateTimeFilter<"Playlist"> | Date | string
    updatedAt?: DateTimeFilter<"Playlist"> | Date | string
  }, "id">

  export type PlaylistOrderByWithAggregationInput = {
    id?: SortOrder
    ownerId?: SortOrder
    roomId?: SortOrderInput | SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    coverUrl?: SortOrderInput | SortOrder
    tags?: SortOrder
    isCollaborative?: SortOrder
    trackIds?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PlaylistCountOrderByAggregateInput
    _max?: PlaylistMaxOrderByAggregateInput
    _min?: PlaylistMinOrderByAggregateInput
  }

  export type PlaylistScalarWhereWithAggregatesInput = {
    AND?: PlaylistScalarWhereWithAggregatesInput | PlaylistScalarWhereWithAggregatesInput[]
    OR?: PlaylistScalarWhereWithAggregatesInput[]
    NOT?: PlaylistScalarWhereWithAggregatesInput | PlaylistScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Playlist"> | string
    ownerId?: StringWithAggregatesFilter<"Playlist"> | string
    roomId?: StringNullableWithAggregatesFilter<"Playlist"> | string | null
    title?: StringWithAggregatesFilter<"Playlist"> | string
    description?: StringNullableWithAggregatesFilter<"Playlist"> | string | null
    coverUrl?: StringNullableWithAggregatesFilter<"Playlist"> | string | null
    tags?: JsonWithAggregatesFilter<"Playlist">
    isCollaborative?: BoolWithAggregatesFilter<"Playlist"> | boolean
    trackIds?: JsonWithAggregatesFilter<"Playlist">
    createdAt?: DateTimeWithAggregatesFilter<"Playlist"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Playlist"> | Date | string
  }

  export type GuestSessionCreateInput = {
    id: string
    nickname: string
    token: string
    createdAt?: Date | string
  }

  export type GuestSessionUncheckedCreateInput = {
    id: string
    nickname: string
    token: string
    createdAt?: Date | string
  }

  export type GuestSessionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    nickname?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GuestSessionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    nickname?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GuestSessionCreateManyInput = {
    id: string
    nickname: string
    token: string
    createdAt?: Date | string
  }

  export type GuestSessionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    nickname?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type GuestSessionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    nickname?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RoomStateCreateInput = {
    id: string
    hostId: string
    joinCode: string
    visibility: string
    playback: JsonNullValueInput | InputJsonValue
    members: JsonNullValueInput | InputJsonValue
    tracks: JsonNullValueInput | InputJsonValue
    queue: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RoomStateUncheckedCreateInput = {
    id: string
    hostId: string
    joinCode: string
    visibility: string
    playback: JsonNullValueInput | InputJsonValue
    members: JsonNullValueInput | InputJsonValue
    tracks: JsonNullValueInput | InputJsonValue
    queue: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RoomStateUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    hostId?: StringFieldUpdateOperationsInput | string
    joinCode?: StringFieldUpdateOperationsInput | string
    visibility?: StringFieldUpdateOperationsInput | string
    playback?: JsonNullValueInput | InputJsonValue
    members?: JsonNullValueInput | InputJsonValue
    tracks?: JsonNullValueInput | InputJsonValue
    queue?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RoomStateUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    hostId?: StringFieldUpdateOperationsInput | string
    joinCode?: StringFieldUpdateOperationsInput | string
    visibility?: StringFieldUpdateOperationsInput | string
    playback?: JsonNullValueInput | InputJsonValue
    members?: JsonNullValueInput | InputJsonValue
    tracks?: JsonNullValueInput | InputJsonValue
    queue?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RoomStateCreateManyInput = {
    id: string
    hostId: string
    joinCode: string
    visibility: string
    playback: JsonNullValueInput | InputJsonValue
    members: JsonNullValueInput | InputJsonValue
    tracks: JsonNullValueInput | InputJsonValue
    queue: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RoomStateUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    hostId?: StringFieldUpdateOperationsInput | string
    joinCode?: StringFieldUpdateOperationsInput | string
    visibility?: StringFieldUpdateOperationsInput | string
    playback?: JsonNullValueInput | InputJsonValue
    members?: JsonNullValueInput | InputJsonValue
    tracks?: JsonNullValueInput | InputJsonValue
    queue?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RoomStateUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    hostId?: StringFieldUpdateOperationsInput | string
    joinCode?: StringFieldUpdateOperationsInput | string
    visibility?: StringFieldUpdateOperationsInput | string
    playback?: JsonNullValueInput | InputJsonValue
    members?: JsonNullValueInput | InputJsonValue
    tracks?: JsonNullValueInput | InputJsonValue
    queue?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlaylistCreateInput = {
    id: string
    ownerId: string
    roomId?: string | null
    title: string
    description?: string | null
    coverUrl?: string | null
    tags: JsonNullValueInput | InputJsonValue
    isCollaborative?: boolean
    trackIds: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PlaylistUncheckedCreateInput = {
    id: string
    ownerId: string
    roomId?: string | null
    title: string
    description?: string | null
    coverUrl?: string | null
    tags: JsonNullValueInput | InputJsonValue
    isCollaborative?: boolean
    trackIds: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PlaylistUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    roomId?: NullableStringFieldUpdateOperationsInput | string | null
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    coverUrl?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: JsonNullValueInput | InputJsonValue
    isCollaborative?: BoolFieldUpdateOperationsInput | boolean
    trackIds?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlaylistUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    roomId?: NullableStringFieldUpdateOperationsInput | string | null
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    coverUrl?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: JsonNullValueInput | InputJsonValue
    isCollaborative?: BoolFieldUpdateOperationsInput | boolean
    trackIds?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlaylistCreateManyInput = {
    id: string
    ownerId: string
    roomId?: string | null
    title: string
    description?: string | null
    coverUrl?: string | null
    tags: JsonNullValueInput | InputJsonValue
    isCollaborative?: boolean
    trackIds: JsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PlaylistUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    roomId?: NullableStringFieldUpdateOperationsInput | string | null
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    coverUrl?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: JsonNullValueInput | InputJsonValue
    isCollaborative?: BoolFieldUpdateOperationsInput | boolean
    trackIds?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PlaylistUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    ownerId?: StringFieldUpdateOperationsInput | string
    roomId?: NullableStringFieldUpdateOperationsInput | string | null
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    coverUrl?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: JsonNullValueInput | InputJsonValue
    isCollaborative?: BoolFieldUpdateOperationsInput | boolean
    trackIds?: JsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type GuestSessionCountOrderByAggregateInput = {
    id?: SortOrder
    nickname?: SortOrder
    token?: SortOrder
    createdAt?: SortOrder
  }

  export type GuestSessionMaxOrderByAggregateInput = {
    id?: SortOrder
    nickname?: SortOrder
    token?: SortOrder
    createdAt?: SortOrder
  }

  export type GuestSessionMinOrderByAggregateInput = {
    id?: SortOrder
    nickname?: SortOrder
    token?: SortOrder
    createdAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }
  export type JsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase<$PrismaModel>>, 'path'>>

  export type JsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type RoomStateCountOrderByAggregateInput = {
    id?: SortOrder
    hostId?: SortOrder
    joinCode?: SortOrder
    visibility?: SortOrder
    playback?: SortOrder
    members?: SortOrder
    tracks?: SortOrder
    queue?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RoomStateMaxOrderByAggregateInput = {
    id?: SortOrder
    hostId?: SortOrder
    joinCode?: SortOrder
    visibility?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RoomStateMinOrderByAggregateInput = {
    id?: SortOrder
    hostId?: SortOrder
    joinCode?: SortOrder
    visibility?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }
  export type JsonWithAggregatesFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedJsonFilter<$PrismaModel>
    _max?: NestedJsonFilter<$PrismaModel>
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type PlaylistCountOrderByAggregateInput = {
    id?: SortOrder
    ownerId?: SortOrder
    roomId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    coverUrl?: SortOrder
    tags?: SortOrder
    isCollaborative?: SortOrder
    trackIds?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PlaylistMaxOrderByAggregateInput = {
    id?: SortOrder
    ownerId?: SortOrder
    roomId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    coverUrl?: SortOrder
    isCollaborative?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PlaylistMinOrderByAggregateInput = {
    id?: SortOrder
    ownerId?: SortOrder
    roomId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    coverUrl?: SortOrder
    isCollaborative?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }
  export type NestedJsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}