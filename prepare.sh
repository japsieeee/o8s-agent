#!/bin/bash

npm run build &&

nfpm package --packager deb --config nfpm.yaml --target dist/