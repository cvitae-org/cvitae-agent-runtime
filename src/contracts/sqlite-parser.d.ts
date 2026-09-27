declare module 'sqlite-parser' {
    const parse: (sql: string) => unknown;
    export default parse;
}
