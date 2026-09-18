How to integrate NPM packages into a Thunderbird Plugin

This is the short story of how I integrated two modified NPM packages with (lots of) transitive dependencies into my Thunderbird Plugin. I managed to overcome the Babel dependency of each package. Everything I show is running on Thunderbird 128esm.

## TL;DR
I packaged the NPM packages with esbuild
```shell
npm install esbuild
esbuild entry_file.js --bundle --outfile=bundled_entry_file_and_dependencies.js --format=esm
```
Example [here](https://github.com/arndissler/example-thunderbird-addon-esbuild/tree/main)

## Context
I was developing a Thunderbird Plugin to easily create events based on date(s) present in the mail subject or content.

After shipping the first version, I realised my code wasn't so great when it came to dates. It steamed both from JavaScript management of dates and the difficulty to parse possible dates. It's possible to handle this without any packages but way suboptimal. It turned out that two packages were solving those issues: [extract-date](https://www.npmjs.com/package/extract-date) and [extract-time](https://www.npmjs.com/package/extract-time).

Those two packages had to be modified to fit exactly my needs. I forked them. It turned out they had transitive dependencies. Copy/pasting the package code to my repo wasn't possible as the dependencies rabbit hole was going too far and most dependencies were relevant. Also, they were quite old (5 years since the last commit) and still relying on Babel.

## Problem
I encountered lots of difficulties when tried to integrate those packages into my Thunderbird Plugin. Lots of configuration were working when I was running my tests (with Chai) but not when I loaded my code as a Thunderbird plugin. 

Here are the error messages I encountered with an extract of the failing code, mostly for Search Engine Optimisation.

```js
import concatMap from 'concat-map'; console.log(concatMap)
```
```
Uncaught TypeError: The specifier “concat-map” was a bare specifier, but was not remapped to anything. Relative module specifiers must start with “./”, “../” or “/”.
```
<br/>

```js
import concatMap from '../node_modules/concat-map/index.js'; console.log(concatMap)
```
```
 Uncaught SyntaxError: The requested module 'moz-extension://ca474688-e787-495e-847a-a42f1e52b51a/node_modules/concat-map/index.js' doesn't provide an export named: 'default'
```
<br/>

```js
import concatMap from '../node_modules/concat-map'; console.log(concatMap)
```
```
Loading script with URI “moz-extension://ca474688-e787-495e-847a-a42f1e52b51a/node_modules/concat-map” was blocked because the file extension is not allowed. _generated_background_page.html Loading failed for the module with source “moz-extension://ca474688-e787-495e-847a-a42f1e52b51a/node_modules/concat-map”
```

More issues came from the packages being quite old and based on Babel. Babel uses CommonJS which doesn't seem to work with Thunderbird 128. Also, Thunderbird 128 migrated from [CommonJS to ESModule](https://developer.thunderbird.net/add-ons/updating/tb128#esmification), so ESModule was the go to choice.

## Solution
### esbuild
After asking on [Mozilla chat](https://chat.mozilla.org/#/room/#tb-addon-developers:mozilla.org), I used `esbuild` as recommended. ESBuild creates a single file with all the code imported from a file, including transitive dependencies. The file is then standalone and follows ES6 standard. It's not optimal in terms of size when applied to lots of packages but in my case it was ok.

On each modified NPM packages repo, I added the following entry 
```shell
npm install --prod # install packages dependencies
npm install esbuild
```

```json
# package.json
{
  ...
  "scripts": {
    "bundle": "esbuild dist/index.js --bundle --outfile=bundle/extract-time.js --format=esm",
    ...
  }
}
```

```shell
npm run build ## required because of Babel (the package is old)
npm run bundle
```

The bundling process worked great. I copy/paste the produced `extract-time.js` to my Thunderbird plugin repo. My tests were working but it wasn't working as a Thunderbird Plugin

### This is not Node.js
In Thunderbird, I had the following error in Thunderbird console (it wasn't showing up in the plugin's console).
```
 Exception during run: Error: Dynamic require of "domain" is not supported
    at file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:11:9
    at node_modules/roarr/dist/factories/createLogger.js (file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:20518:16)
    at __require2 (file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:14:50)
    at node_modules/roarr/dist/factories/index.js (file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:20921:48)
    at __require2 (file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:14:50)
    at node_modules/roarr/dist/log.js (file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:20941:22)
    at __require2 (file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:14:50)
    at file:///home/louis/src/thunderbird_plugin_mail_to_event/dependencies/extract-date.js:56120:28
```

The culprit was the following code
```js
let domain;
if (detect_node_1.default) {
    domain = require('domain');
}
```
`require('domain');` only works on Node.js , it doesn't work in browser or mail client such as Thunderbird.

Even though that part of the code wasn't supposed to run, it was failing. I decided to remove the library that was importing this code altogether. Upgrading the library's version in my specific case may have solved the problem.

### Result 
```
$ npm run build
> extract-date@3.0.0-local bundle
> esbuild dist/index.js --bundle  --platform=node --outfile=bundle/extract-date.js --format=esm


  bundle/extract-date.js  2.9mb ⚠️

⚡ Done in 78ms
```
I created a folder dedicated to bundled packages in my Thunderbird plugin repo and was able to import code directly from it. It's now working seamlessly.

I was able to repeat the same process with both packages.

You can also find an example of the same process in a [dedicated repo here](https://github.com/arndissler/example-thunderbird-addon-esbuild/tree/main
).

## After bundling
Keep in mind that Thunderbird guidelines for Plugin requires you to document bundled packages and give enough documentation for reviewers to reproduce each bundle. I would advise to avoid too many manual steps in the bundling process in that regard. 

Ideally, I would advice to bundle from your Thunderbird plugin's repository. Also, bundle only NPM packages which are in your `package.json`. Also, have a `npm` command that (re)creates all the bundles (e.g. `npm run bundle_dependencies`). It will make the review of your package easier and faster.

It works great, even with old packages!

## Credits
Huge shout-out to [Mozilla community](https://chat.mozilla.org/#/room/#tb-addon-developers:mozilla.org) which was quick to reply with relevant information. Many thanks to [Arnd Issler](https://github.com/arndissler/) and [Mark Banner](https://github.com/Standard8) .
Check out Arnd Issler's repo dedicated to this bundling process : https://github.com/arndissler/example-thunderbird-addon-esbuild/tree/main

Also, thanks to [Gajus Kuizinas](https://github.com/gajus) for the [extract-date](https://www.npmjs.com/package/extract-date) and [extract-time](https://www.npmjs.com/package/extract-time) packages. It's not been updated for 5 years but still works great!

Thank you for reading. If you want to check my plugin, here is the [download page](https://addons.thunderbird.net/fr/thunderbird/addon/events-from-mail-content/?src=github) and the [source code](https://github.com/LouisJULIEN/thunderbird_plugin_mail_to_event). Here is the source code of two modified packages [extract-time](https://github.com/LouisJULIEN/extract-time) and [extract-date](https://github.com/LouisJULIEN/extract-date).
