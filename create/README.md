# @dbu6/create

Makes a new [dbu6](https://github.com/jasim/dbu6#readme) books folder:

```sh
npm init @dbu6 my-books
```

npm runs this package for `npm init @dbu6`. It runs `dbu6 init` from
[`@dbu6/app`](https://www.npmjs.com/package/@dbu6/app), which it depends on at
its own version, so `npm init @dbu6@1.2.3 my-books` makes a folder on dbu6
1.2.3. Everything else is `@dbu6/app`'s; see
[Getting started](https://github.com/jasim/dbu6/blob/main/docs/getting-started.md).
