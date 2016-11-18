#!/bin/bash

for i in {1..84}
do
  # Process 600 requests in a single request, every 1 minute
  last=$((i*600))
  first=$((last-599))

  #echo $first
  #echo $last
  printf -v container "morningstar-fund-%d" $i
  echo "$container: ($first - $last)"
  cf ic run --name ${container} -m 128 --env-file=.env registry.ng.bluemix.net/tuton/morningstar-fund -f ${first} -l ${last}

  #number=$((1 + RANDOM % 1))
  #number=$((${RANDOM}%98+1))
  #printf -v number "0.%.2d" $number
  number=60

  echo "Sleeping for $number seconds..."
  sleep $number
  echo "Done!"
done
