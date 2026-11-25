# Third-party notices

The browser MP3 encoder uses `@breezystack/lamejs` version 1.2.7, an unmodified JavaScript port of LAME, distributed under LGPL-3.0.

- LAME: https://lame.sourceforge.net/
- Package and complete dependency source: https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7
- Upstream source: https://github.com/shijinyu/lamejs
- License: https://www.gnu.org/licenses/lgpl-3.0.html
- Package license notice: [public/licenses/lamejs.txt](public/licenses/lamejs.txt)

The application's MP3 worker source is in `src/audio/mp3-worker.js` and `src/audio/encode-mp3.js`. To rebuild it with a replacement encoder, replace `@breezystack/lamejs` with a compatible `Mp3Encoder` implementation, then run `npm install` and `npm run build`. The worker is emitted separately from the main application bundle. The dependency source package can be obtained with `npm pack @breezystack/lamejs@1.2.7`.

Other dependencies retain their licenses in their installed packages. Mitr is provided by Google Fonts under the SIL Open Font License: https://github.com/google/fonts/tree/main/ofl/mitr.
