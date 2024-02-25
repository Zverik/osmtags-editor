#!/bin/bash
set -eu
rm -f osmtags-firefox.zip osmtags-chrome.zip
mkdir tmp
cp manifest.json osmorg-editor.js sidebar-listener.js land.html osm-auth.iife.min.js osmtags-48.png osmtags-96.png osmtags-128.png LICENSE README.md tmp
cd tmp
zip -q ../osmtags-firefox.zip *
cp ../manifest3.json manifest.json
zip -q ../osmtags-chrome.zip *
cd ..
rm -r tmp
