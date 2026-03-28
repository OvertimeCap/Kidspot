#!/bin/bash
set -e

echo "Running post-merge setup..."
npm install
npm run db:push -- --force
echo "Post-merge setup complete."
