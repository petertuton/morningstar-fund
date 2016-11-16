var dotenv = require('dotenv').config({silent: true}),
  Cloudant = require('cloudant'),
  cloudant = Cloudant({url: process.env.CLOUDANT_URL, plugin:'retry', retryAttempts:100}),
  request = require("request"),
  cheerio = require('cheerio');

// Grab the command line arguments
const commandLineArgs = require('command-line-args');
const optionDefinitions = [
  { name: 'verbose', alias: 'v', type: Boolean },
  { name: 'first', alias: 'f', type: Number },
  { name: 'last', alias: 'l', type: Number },
  { name: 'replace', alias: 'r', type: Boolean }
];
const options = commandLineArgs(optionDefinitions);

// Globals
GLOBAL.verbose = options.verbose;
GLOBAL.funddb;

var first = options.first,
    last = options.last ? options.last : options.first;

if ( first === undefined || last === undefined) {
  console.log("Missing first and/or last parameters");
  return;
}
console.log("Requesting funds in the following range: " + first + "-" + last);

// Remove any existing database named "fund"
if (verbose) console.log("Destroying existing fund database...");
cloudant.db.destroy('fund', function(err) {
  // Create a new "fund" database
  if (verbose) console.log("Creating fund database...");
  cloudant.db.create('fund', function() {
    // Use the fund database
    funddb = cloudant.db.use('fund');
    // Request and insert the funds
    if (verbose) console.log("Requesting and inserting funds...");
    for (var i = first; i <= last; i++) {
      requestFund(i.toString())
      .then(insertFund)
      .catch(function(err) {
        console.error(err);
      });
    }
  });
});


////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

function insertFund(fund) {
  return new Promise(function(resolve, reject) {
    funddb.insert(fund, function(err, body, header) {
      if (err) {
        reject('[funddb.insert:' + fund._id + '] ' + err.message);
        return;
      }
      console.log('Inserted the fund: ' + fund._id);
      if (verbose) console.log(body);
      resolve(true);
    });
  })
}

////////////////////////////////////////////////////////////////////////////////

function requestFund(fundId) {
  // Check the params
  return new Promise(function(resolve, reject) {
    // Set the fundId
    if (!fundId) {
      reject({error: "No fundId parameter"});
      return;
    }

    // Request the fund
    var fundURL = "http://www.morningstar.com.au/Fund/FundReportPrint/" + fundId;
    request(fundURL, function (error, response, html) {
      // Check for an error
      if (error) {
        reject({error: error});
        return;
      }
      // Check for a non 200 response code
      if (response.statusCode != 200) {
        reject({error: "statusCode: " + response.statusCode});
        return;
      }

      // The "Asset Allocation" table annoyingly has an extra </tr> - remove it
      // Probably could just use the replace method...
      var extraTR = html.indexOf("<td class=\"borderbottom YMWpadleft\">International Equity</td>");
      if (extraTR > 0) {
        var leftHTML = html.substr(0, extraTR-80) + "</tr>\n"
        var rightHTML = html.slice(extraTR-5, html.length);
        rightHTML = "<tr>\n" + rightHTML;
        html = leftHTML + rightHTML;
      }

      // Replace rating images with text
      html = html.replace(/<img src=\"\/Content\/images\/5starscropped.gif\" alt=\"5\" \/>/g, "5");
      html = html.replace(/<img src=\"\/Content\/images\/4starscropped.gif\" alt=\"4\" \/>/g, "4");
      html = html.replace(/<img src=\"\/Content\/images\/3starscropped.gif\" alt=\"3\" \/>/g, "3");
      html = html.replace(/<img src=\"\/Content\/images\/2starscropped.gif\" alt=\"2\" \/>/g, "2");
      html = html.replace(/<img src=\"\/Content\/images\/1starscropped.gif\" alt=\"1\" \/>/g, "1");

      // Replace instances of <br /> with " "
      html = html.replace(/<br \/>/g, " ");

//        console.log("############################################");
//        console.log("### HTML");
//        console.log("############################################");
//        console.log(html);

      // Load the HTML into cheerio to make it easier to parse
      var $ = cheerio.load(html);

      // Check for a non-existent fund, by checking for class=red
      // (there might be a better way, but this will do for now)
      if ($('.red').length > 0) {
        reject("Non-existent fund: " + fundId);
        /*
        reject({
          error: "Non-existent fund: " + fundId,
          statusCode: 404,
          fundURL: fundURL
        });
        */
        return;
      }

      // Init the fund object
      var fund = {
        _id: fundId,
        URL: fundURL,
        Name: $('.YMWCoyFull').text()
      };

      // Iterate the fund's tables, processing them maccordingly
      $('.YMWTableSmall').each(function(index, table) {
//          console.log("############################################");
//          console.log($(table).html());

        var tableName = getTableName($, table);
        if (tableName === "Performance")
          return; // Ignore the Performance table
//          console.log("############################################");
//          console.log("### "+ tableName);
//          console.log("############################################");
        fund[tableName] = extractTable($, table, ( hasColumnHeadings(tableName) ? getColumnHeadings($, table) : null));
      });

      if (verbose) {
        console.log("############################################");
        console.log("### fund ");
        console.log("############################################");
        console.log(fund);
      }
      resolve(fund);
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
// Supporing functions
////////////////////////////////////////////////////////////////////////////////

function hasColumnHeadings(table_name) {
  var result = false;
  switch(table_name) {
    case 'Financial Year Returns':
    case 'Trailing Year Returns':
    case 'Risk Analysis':
      result = true;
    break;
    default:
      result = false;
  };
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function isNull(value) {
  return (value === undefined || value === null);
}

////////////////////////////////////////////////////////////////////////////////

function arraysToHash(headings, row) {
  var result = {}, key = row[0];

  if ( isNull(headings) ) {
    result[key] = row[1];
    return result;
  };

  var h_index = 0;
  for (var i = 1, len = row.length; i < len; i++) {
    if ( h_index < headings.length && !isNull(row[i]) ) {
      result[ key + " " + headings[h_index] ] = row[i];
      h_index++;
    }
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function cellValue($, cellIndex, cell, isHeader) {
  // Removes everything between brackets
  var result = $(cell).text().trim().replace(/ *\([^)]*\)/g, "").replace(/%/g, "").replace(/,/g, "").replace(/--/g, "null");
  // Convert to number, if possible
  var number = Number(result);
  return number || (number===0) ? number : result === "null" ? null : result;
}

////////////////////////////////////////////////////////////////////////////////

function rowValues($, row, isHeader) {
  var result = [];
  $(row).children('td,th').each(function(cellIndex, cell) {
    if ( !isHeader || (isHeader && cellIndex > 0) )
      result.push( cellValue($, cellIndex, cell, isHeader) );
  });
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function getColumnHeadings($, table) {
  // The column headings are in the second row
  return rowValues($, $(table).find('tr').first().next(), true);
}

////////////////////////////////////////////////////////////////////////////////

function getTableName($, table) {
  // The table name is stored in the first cell of the first row
  return cellValue($, 0, $(table).find('tr').first().find('td').first(), false);
}

////////////////////////////////////////////////////////////////////////////////

function extractTable($, table, headings) {
  var i, j, len, len2, txt, $row, $cell,
  $table = $(table),
  tmpArray = [], cellIndex = 0, result = [];
  $table.children('tbody,*').children('tr').each(function(rowIndex, row) {
    if( rowIndex > (isNull(headings) ? 0 : 1) ) {
      $row = $(row);
//      console.log("Row: " + $row.html());
      var isEmpty = ($row.find('td').length === $row.find('td:empty').length) ? true : false;

      if( !isEmpty ) {
        cellIndex = 0;
        if (!tmpArray[rowIndex]) {
          tmpArray[rowIndex] = [];
        }

        $row.children().each(function() {
          $cell = $(this);
          // skip column if already defined
          while (tmpArray[rowIndex][cellIndex]) { cellIndex++; }

          txt = tmpArray[rowIndex][cellIndex] || cellValue($, cellIndex, $cell);
          if (!isNull(txt)) {
            tmpArray[rowIndex][cellIndex] = txt;
          }
          cellIndex++;
        });
      };
    }
  });

  for (i = 0, len = tmpArray.length; i<len; i++) {
    row = tmpArray[i];
    if (!isNull(row)) {
      txt = arraysToHash(headings, row);
      result[result.length] = txt;
    }
  }

  // Post table extraction processing
  switch (getTableName($, table))
  {
    case "Current Investment Style":
      result = fixCurrentInvestmentStyle(result);
      break;
    case "Quick Stats":
      result = fixQuickStats(result);
      break;
    case "Asset Allocation":
      result = fixAssetAllocation(result);
      break;
  }

  // Convert the array of objects into an array of a single object
  result = convertToSingleObject(result);

//  console.log("### extractTable ############################################");
//  console.log(result);
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function convertToSingleObject(result) {
  var temp = {};
  for (i = 0, len=result.length; i<len; i++) {
    var keys = Object.keys(result[i]);
    for (j = 0, len2=keys.length; j<len2; j++) {
      temp[keys[j]] = result[i][keys[j]];
    }
  }
  return temp;
}

////////////////////////////////////////////////////////////////////////////////

function fixCurrentInvestmentStyle(table) {
  var result = [];
  for (var i = 0, len = table.length; i < len; i++) {
    switch(i) {
      case 0:
        // "as at"
        var value = Object.keys(table[i])[0].trim();
        value = value.slice(5,value.length).trim();
        result.push({'As at': value});
        break;
      case 1:
        // Ignore the second row
        break;
      case 2:
        // Strip the market cap and investment style information
        var value = Object.keys(table[i])[0].replace(/\u00a0/g, " ");
        var arr = value.split("  ");
        result.push({'Market Cap': arr[0].slice(7, arr[0].length)});
        result.push({'Investment Style': arr[1].slice(7, arr[1].length)});
        break;
    };
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function fixQuickStats(table) {
  var result = [];
  for (var i = 0, len = table.length; i < len; i++) {
    switch(i) {
      case 0:
        // "as at"
        var value = Object.keys(table[i])[0].trim();
        value = value.slice(5,value.length).trim();
        result.push({'As at': value});
        break;
      default:
        // Strip the key from the value
        var row = {};
        var arr = Object.keys(table[i])[0].split("\r\n                        ");
        row[arr[0]] = arr[1];
        result.push(row);
    };
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function fixAssetAllocation(table) {
  var result = [];
  for (var i = 0, len = table.length; i < len; i++) {
    switch(i) {
      case 0:
        // "as at"
        var value = Object.keys(table[i])[0].trim();
        value = value.slice(5,value.length).trim();
        result.push({'As at': value});
        break;
      default:
        // Just add it to the result
        result.push(table[i]);
    };
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////
