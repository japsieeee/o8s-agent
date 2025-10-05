#!/bin/bash

PACKAGE_NAME=o8s-agent_1.0.0_amd64.deb

npm run build &&

nfpm package --packager deb --config nfpm.yaml --target dist/ &&


rm -rf /tmp/$PACKAGE_NAME &&

mv ./dist/$PACKAGE_NAME /tmp/$PACKAGE_NAME &&

sudo apt install /tmp/$PACKAGE_NAME