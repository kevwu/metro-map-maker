// MetroMapMaker.js

var gridRows = 80, gridCols = 80;
var activeTool = 'look';
var activeMap = false;
var preferredGridPixelMultiplier = 20;
var lastStrokeStyle;
var lineWidth = 1.175;
var redrawOverlappingPoints = {};

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
}; // String.replaceAll()

function resizeGrid(size) {
  // Change the grid size to the specified size.

  metroMap = saveMapAsObject(); // Save map as we currently have it so we can load it

  // Resize the grid and paint the map on it
  size = parseInt(size);
  gridRows = size;
  gridCols = size;
  loadMapFromObject(metroMap);
  bindRailLineEvents();

  $('.resize-grid').removeClass('btn-primary');
  $('.resize-grid').addClass('btn-info');
  $('#tool-resize-' + size).removeClass('btn-info');
  $('#tool-resize-' + size).addClass('btn-primary');
  resizeCanvas();
} // resizeGrid(size)

function setSquareSize(size) {
  // When the grid was only 80x80, I could get away with setting the width/height
  //  individually using something like $('.grid-col').width()
  //  but that's not feasible for 320x320, and it's slower than it needs to be.
  // Instead, set a CSS class applied to .grid-col rather than changing the style individually
  $('.square-size').remove(); // Remove old stylings so these don't pile up, causing a minor leak
  var style = document.createElement('style');
  style.type = 'text/css';
  style.classList.add('square-size');
  style.innerHTML = '.grid-col { width: ' + size + 'px; height: ' + size + 'px; }';
  document.getElementsByTagName('head')[0].appendChild(style);
}

function resizeCanvas() {
  // Whenever the pixel width or height of the grid changes,
  // like on page load, map resize, or zoom in/out, 
  // the #metro-map-canvas size needs to be updated as well so they overlap

  // Resize the canvas as needed
  var canvas = document.getElementById('metro-map-canvas');
  var canvasStations = document.getElementById('metro-map-stations-canvas');
  if (canvas.height / gridCols != preferredGridPixelMultiplier) {
    // Maintain a nice, even gridPixelMultiplier so the map looks uniform at every size
    // On iPhone for Safari, canvases larger than 4096x4096 would crash, so cap it
    //  (this really only affects maps at 240x240)
    if (gridCols * preferredGridPixelMultiplier <= 4096) {
      canvas.height = gridCols * preferredGridPixelMultiplier;
      canvasStations.height = gridCols * preferredGridPixelMultiplier;
    } else {
      canvas.height = 4096;
      canvasStations.height = 4096;
    }
    if (gridRows * preferredGridPixelMultiplier <= 4096) {
      canvas.width = gridRows * preferredGridPixelMultiplier;
      canvasStations.width = gridRows * preferredGridPixelMultiplier;
    } else {
      canvas.width = 4096;
      canvasStations.width = 4096;
    }
  } // if canvas.height / gridCols != preferredGridPixelMultiplier

  var computedSquareSize = window.getComputedStyle(document.getElementById('coord-x-0-y-0')).width.split("px")[0];
  $('#metro-map-canvas').width(computedSquareSize * gridCols);
  $('#metro-map-canvas').height(computedSquareSize * gridCols);
  $('#metro-map-stations-canvas').width(computedSquareSize * gridCols);
  $('#metro-map-stations-canvas').height(computedSquareSize * gridCols);

  drawCanvas();
} // resizeCanvas()

function getActiveLine(x, y, metroMap) {
  // Given an x, y coordinate pair, return the hex code for the line you're on.
  // Use this to retrieve the line for a given point on a map.
  if (metroMap && metroMap[x] && metroMap[x][y] && metroMap[x][y]["line"]) {
    return metroMap[x][y]["line"];
  } else if (metroMap) {
    // metroMap was passed through but there was nothing at that x,y coordinate
    return undefined;
  }
  var square = document.getElementById('coord-x-' + x + '-y-' + y);
  if (!square) {
    // With the new straight lines replacing the old bubbles system of drawing the maps onto the canvas, you will land here on occasion when the maps reach the borders. (For example, y-80 which does not exist in the 80x80 grid.) Do not panic, instead just keep on keeping on.
    return false;
  }
  var classes = square.classList;
  for (var z=0; z<classes.length; z++) {
    if (classes[z].indexOf('has-line-') !== -1) {
      // Potential feature: by returning here at the first has-line- found,
      //   you can't accidentally overwrite an existing rail line anymore
      //   and will need to erase that line first if you want to change its color.
      // return classes[z].slice(9, 15);
      // If the preferred behavior is to overwrite a square's color by drawing over it,
      //   then set the variable here and return after the loop ends.
      var activeLine = classes[z].slice(9, 15);
    }
  }
  return activeLine;
} // getActiveLine(x, y)

function moveLineStroke(ctx, x, y, lineToX, lineToY) {
  // Used by drawPoint() to draw lines at specific points
  ctx.moveTo(x * gridPixelMultiplier, y * gridPixelMultiplier);
  ctx.lineTo(lineToX * gridPixelMultiplier, lineToY * gridPixelMultiplier);
  singleton = false;
} // moveLineStroke(ctx, x, y, lineToX, lineToY)

function getStationLines(x, y) {
  // Given an x, y coordinate pair, return the hex codes for the lines this station services.
  var classes = document.getElementById('coord-x-' + x + '-y-' + y).children[0].className.split(/\s+/);
  var stationLines = [];
  for (var z=0; z<classes.length; z++) {
    if (classes[z].indexOf('has-line-') >= 0) {
      stationLines.push(classes[z].slice(9, 15));
    }
  }
  return stationLines;
} // getStationLines(x, y)

function bindRailLineEvents() {
  // Bind the events to all of the .rail-lines
  // Needs to be done whenever a new rail line is created and on page load
  $('.rail-line').click(function() {
    if ($(this).attr('id') == 'rail-line-new') {
      // New Rail Line
      $('#tool-new-line-options').show();
    } else {
      // Existing Rail Line
      activeTool = 'line';
      activeToolOption = $(this).css('background-color');
    }
    $('#toolbox button').removeClass('btn-primary').addClass('btn-info');
    $('#tool-station-options').hide();
    $('#tool-station').html('<i class="fa fa-map-pin" aria-hidden="true"></i> Add/Edit Station');
  });  
} // bindRailLineEvents()

function bindGridSquareEvents() {
  $('#station-coordinates-x').val('');
  $('#station-coordinates-y').val('');

  if (activeTool == 'line') {
    // I need to clear the redrawArea first
    // BEFORE actually placing the line
    // The first call to drawArea() will erase the redrawSection
    // The second call actually draws the points
    var x = $(this).attr('id').split('-').slice(2, 3);
    var y = $(this).attr('id').split('-').slice(4);
    drawArea(x, y, metroMap, true);

    // Remove any existing colors here before adding them
    // This fixes the bug where making a line with one color
    // and a second line that intersects it would cause the intersection point to
    // have the has-line- class for both colors, and the intersection point would no longer
    // be writeable unless it were erased first
    var classes = document.getElementById('coord-x-' + x + '-y-' + y).className.split(/\s+/);
    var currentLines = [];
    for (var z=0; z<classes.length; z++) {
      if (classes[z].indexOf('has-line-') >= 0) {
        // currentLines.push(classes[z].slice(9, 15));
        $(this).removeClass(classes[z]);
      }
    }

    $(this).addClass('has-line')
    $(this).addClass('has-line-' + rgb2hex(activeToolOption).slice(1, 7));
    metroMap = updateMapObject(x, y, activeTool);
    autoSave(metroMap);
    drawArea(x, y, metroMap);
  } else if (activeTool == 'eraser') {
    // I need to check for the old line and station
    // BEFORE actually doing the erase operations
    var x = $(this).attr('id').split('-').slice(2, 3);
    var y = $(this).attr('id').split('-').slice(4);
    erasedLine = getActiveLine(x, y);
    if ($('#coord-x-' + x + '-y-' + y).hasClass('has-station')) {
      var redrawStations = true;
    } else {
      var redrawStations = false;
    }

    $(this).removeClass();
    $(this).addClass('grid-col');
    $(this).html('');

    metroMap = updateMapObject(x, y, activeTool);
    autoSave(metroMap);
    drawArea(x, y, metroMap, erasedLine, redrawStations);
  } else if (activeTool == 'station') {

    $('#station-name').val('');
    $('#station-on-lines').html('');
    var x = $(this).attr('id').split('-').slice(2, 3);
    var y = $(this).attr('id').split('-').slice(4);
    $('#station-coordinates-x').val(x);
    $('#station-coordinates-y').val(y);
    var allLines = $('.rail-line');

    if (getActiveLine(x, y)) {
      var metroMap = saveMapAsObject();
      drawCanvas(metroMap, true);
      drawIndicator(x, y);
      // Only expand the #tool-station-options if it's actually on a line
      // Now, there are two indicators for when a station has been placed on a line
      // and zero visual indicators for when a station gets placed on a blank square
      $('#tool-station-options').show();
    } else {
      $('#tool-station-options').hide();
      $('#tool-station').html('<i class="fa fa-map-pin" aria-hidden="true"></i> Add/Edit Station');
    }

    if ($(this).hasClass('has-station')) {
      // Already has a station, so clicking again shouldn't clear the existing station but should allow you to rename it and assign lines
      if ($(this).children().attr('id')) {
        // This station already has a name, show it in the textfield
        var stationName = $(this).children().attr('id').replaceAll('_', ' ');
        $('#station-name').val(stationName);

        // Pre-check the box if this is a transfer station
        var existingStationClasses = document.getElementById('coord-x-' + x + '-y-' + y).children[0].className.split(/\s+/);
        if (existingStationClasses.indexOf('transfer-station') >= 0) {
          $('#station-transfer').prop('checked', true);
        } else {
          $('#station-transfer').prop('checked', false);
        }

        // Select the correct orientation too.
        if (existingStationClasses.indexOf('rot135') >= 0) {
          document.getElementById('station-name-orientation').value = '135';
        } else if (existingStationClasses.indexOf('rot-45') >= 0) {
          document.getElementById('station-name-orientation').value = '-45';
        } else if (existingStationClasses.indexOf('rot45') >= 0) {
          document.getElementById('station-name-orientation').value = '45';
        } else if (existingStationClasses.indexOf('rot180') >= 0) {
          document.getElementById('station-name-orientation').value = '180';
        } else {
          document.getElementById('station-name-orientation').value = '0';
        }

        var stationOnLines = "";
        var stationLines = getStationLines(x, y);
        for (var z=0; z<stationLines.length; z++) {
          if (stationLines[z]) {
            stationOnLines += "<button style='background-color: #" + stationLines[z] + "' class='station-add-lines' id='add-line-" + stationLines[z] + "'>" + $('#rail-line-' + stationLines[z]).text() + "</button>";
          }
        }
      } else {
        // This only happens when you create a new station and then click on it again (without having named it first)
        // This fixes the bug where it would erroneously clear the station that it was sitting on and not allow you to add it back
        activeLine = getActiveLine(x, y);
        if (activeLine) {
          $(this).children().addClass('has-line-' + activeLine);
          stationOnLines = "<button style='background-color: #" + activeLine + "' class='station-add-lines' id='add-line-" + activeLine + "'>" + $('#rail-line-' + activeLine).text() + "</button>";
          stationLines = activeLine;
        }
      }
    } else {
      // Create a new station
      $(this).addClass('has-station');
      $(this).html('<div class="station"></div>');
      $('#station-transfer').prop('checked', false);
      var lastStationOrientation = window.localStorage.getItem('metroMapStationOrientation');
      if (lastStationOrientation) {
        document.getElementById('station-name-orientation').value = lastStationOrientation;
        $('#station-name-orientation').change(); // This way, it will be saved
      } else {
        document.getElementById('station-name-orientation').value = '0';
      }

      // Pre-populate the station with the line it sits on
      activeLine = getActiveLine(x, y);
      if (activeLine) {
        // If the station is added to a space with no rail line, don't add any active lines
        $(this).children().addClass('has-line-' + activeLine);
        stationOnLines = "<button style='background-color: #" + activeLine + "' class='station-add-lines' id='add-line-" + activeLine + "'>" + $('#rail-line-' + activeLine).text() + "</button>";
        stationLines = activeLine;

        // Pre-populate the station with its neighboring lines
        for (var nx=-1; nx<=1; nx+=1) {
          for (var ny=-1; ny<=1; ny+=1) {
            neighboringLine = getActiveLine(parseInt(x) + parseInt(nx), parseInt(y) + parseInt(ny));
            if (neighboringLine) {
              $(this).children().addClass('has-line-' + neighboringLine);
              if (typeof stationLines == "string") {
                stationLines = [stationLines]
              }
              if (stationOnLines && stationOnLines.indexOf(neighboringLine) >= 0) {
                // Don't add lines that are already added
              } else {
                stationOnLines += "<button style='background-color: #" + neighboringLine + "' class='station-add-lines' id='add-line-" + neighboringLine + "'>" + $('#rail-line-' + neighboringLine).text() + "</button>";
                stationLines.push(neighboringLine);
              }
            } // if (neighboringLine)
          } // for ny
        } // for nx
      } // if (activeLine)
    } // else (new station)

    // Make the station options button collapsible
    if ($('#tool-station-options').is(':visible')) {
      $('#tool-station').html('<i class="fa fa-map-pin" aria-hidden="true"></i> Hide Station Options');
    }

    // Add lines to the "Other lines this station serves" option
    if (stationOnLines) {
      $('#station-on-lines').html(stationOnLines);

      var linesToAdd = "";

      for (var z=0; z<allLines.length; z++) {
        if ((stationLines == allLines[z].id.slice(10, 16) || stationLines.indexOf(allLines[z].id.slice(10,16)) >= 0) || allLines[z].id.slice(10,16) == 'new') {
          // Looping through all of the lines, if this line is already in the station's lines, don't add it
          // Don't add the "Add new line" button either
        } else {
          linesToAdd += '<button style="background-color: #' + allLines[z].id.slice(10, 16) + '" class="station-add-lines" id="add-line-' + allLines[z].id.slice(10, 16) + '">' + $('#' + allLines[z].id).text() + '</button>';
        }
      } // for allLines
      if (linesToAdd) {
        $('#station-other-lines').html(linesToAdd);
        // Bind the event to the .station-add-lines buttons here since they are newly created.
        $('.station-add-lines').click(function() {
          if ($(this).parent().attr('id') == 'station-other-lines') {
            $('#station-on-lines').append($(this));
            $('#coord-x-' + x + '-y-' + y).children().addClass('has-line-' + $(this).attr('id').slice(9, 15));

          } else {
            // Remove it
            $('#station-other-lines').append($(this));
            $('#coord-x-' + x + '-y-' + y).children().removeClass('has-line-' + $(this).attr('id').slice(9, 15));
          }

        });
      } // if linesToAdd
    } // if stationOnLines

    $('#station-name').focus(); // Set focus to the station name box to save you a click each time
  } // if activeTool == station
} // bindGridSquareEvents()

function bindGridSquareMouseover() {
  if (mouseIsDown) {
    $(this).click();
  }
} // bindGridSquareMouseover()

function drawGrid() {
  // Creates the grid of DIVs that are used to hold the classes and styling
  // Most of the complexity here is in binding events to the grid squares upon regeneration
  var grid = "";

  // Generate the grid
  for (var x=0; x<gridRows; x++) {
    grid += '<div class="grid-row">';
    for (var y=0; y<gridCols; y++) {
      grid += '<div id="coord-x-' + x + '-y-' + y + '" class="grid-col"></div>';
    }
    grid += '</div> <!-- div.grid-row -->';
  }

  $('#grid').html(grid);

  setSquareSize($('#grid').width() / gridCols);
  resizeCanvas();

  // Then bind events to the grid
  var squares = document.getElementsByClassName("grid-col");
  for (var s=0; s<squares.length; s++) {
      squares[s].addEventListener('click', bindGridSquareEvents, false);
      squares[s].addEventListener('mousedown', bindGridSquareEvents, false);
      squares[s].addEventListener('mouseover', bindGridSquareMouseover, false);
  }
} // drawGrid()

function getRedrawSection(x, y, metroMap, redrawRadius) {
  // Returns an object that's a subset of metroMap
  // containing only the squares within redrawRadius of x,y
  redrawSection = {}
  redrawRadius = parseInt(redrawRadius)
  for (var nx=redrawRadius * -1; nx<=redrawRadius; nx+=1) {
    for (var ny=redrawRadius * -1; ny<=redrawRadius; ny+=1) {
      if (getActiveLine(x + nx, y + ny, metroMap)) {
        if (!redrawSection.hasOwnProperty(x + nx)) {
          redrawSection[x + nx] = {}
          redrawSection[x + nx][y + ny] = true;
        } else {
          redrawSection[x + nx][y + ny] = true;
        }
      }
    } // for ny
  } // for nx
  return redrawSection;
} // getRedrawSection(x, y, metroMap, redrawRadius)

function drawArea(x, y, metroMap, erasedLine, redrawStations) {
  // Partially draw an area centered on x,y
  // because it's faster than drawing the full canvas

  var canvas = document.getElementById('metro-map-canvas');
  var ctx = canvas.getContext('2d', {alpha: false});
  gridPixelMultiplier = canvas.width / gridCols;

  var redrawRadius = 1;

  x = parseInt(x);
  y = parseInt(y);

  ctx.lineWidth = gridPixelMultiplier * lineWidth;
  ctx.lineCap = 'round';

  if (activeTool == 'eraser') {
    if (erasedLine) {
      drawPoint(ctx, x, y, metroMap, erasedLine);
    } // if erasedLine
  } // if activeTool == 'eraser'

  // Determine redraw area and redraw the points that need to be redrawn
  redrawSection = getRedrawSection(x, y, metroMap, redrawRadius);
  for (var x in redrawSection) {
    for (var y in redrawSection[x]) {
      lastStrokeStyle = undefined; // I need to set lastStrokeStyle here, otherwise drawPoint() has undefined behavior
      x = parseInt(x);
      y = parseInt(y);
      if (activeTool == 'line' && erasedLine) {
        // When drawing lines, we call drawArea() twice.
        // First call: erase all the squares in the redrawSection
        // Second call: re-draw all the squares
        drawPoint(ctx, x, y, metroMap, getActiveLine(x,y));
      } else {
        drawPoint(ctx, x, y, metroMap);
      } // else (of if activeTool is line and first pass)
    } // for y
  } // for x

  if (redrawStations) {
    // Did I erase a station? Re-draw them all here
    var canvasStations = document.getElementById('metro-map-stations-canvas');
    var ctxStations = canvasStations.getContext('2d', {alpha: true});
    ctxStations.clearRect(0, 0, canvasStations.width, canvasStations.height);
    ctxStations.font = '700 20px sans-serif';

    for (var x in metroMap){
      for (var y in metroMap[x]) {
        x = parseInt(x);
        y = parseInt(y);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          continue;
        }
        drawStation(ctxStations, x, y, metroMap);
      } // for y
    } // for x
  } // if redrawStations
} // drawArea(x, y, metroMap, redrawStations)

function drawCanvas(metroMap, stationsOnly) {
  // Fully redraw the canvas based on the provided metroMap;
  //    if no metroMap is provided, then save the existing grid as a metroMap object
  //    then redraw the canvas
  if (stationsOnly) {
    // If I'm only changing the stations, I only need to update the stations canvas
  } else {
  var canvas = document.getElementById('metro-map-canvas');
  var ctx = canvas.getContext('2d', {alpha: false});

  // How much larger is the canvas than the grid has in squares?
  // If the grid has 80x80 squares and the canvas is 1600x1600,
  //    then the gridPixelMultiplier is 20 (1600 / 80)
  gridPixelMultiplier = canvas.width / gridCols; // 20

  // Clear the canvas, make the background white instead of transparent
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!metroMap) {
    metroMap = saveMapAsObject();
  }
  activeMap = metroMap;

  ctx.lineWidth = gridPixelMultiplier * lineWidth;
  ctx.lineCap = 'round';

  for (var x in metroMap) {
    for (var y in metroMap[x]) {
      x = parseInt(x);
      y = parseInt(y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        continue;
      }
      drawPoint(ctx, x, y, metroMap);
    }
  }

  // Redraw select overlapping points
  // This solves the "Southeast" problem
  //  where if two adjacent lines were heading southeast, they would overlap
  //  in ways that didn't happen for two adjacent lines heading northeast
  var reversed = Object.keys(redrawOverlappingPoints).reverse();
  for (var i=0; i<reversed.length; i++) {
    var x = reversed[i];
    for (var y in redrawOverlappingPoints[x]) {
      x = parseInt(x);
      y = parseInt(y);
      drawPoint(ctx, x, y, metroMap);
    }
  }
  redrawOverlappingPoints = {};
  } // else (of if stationsOnly)
  // Draw the stations separately, or they will be painted over by the lines themselves.
  var canvas = document.getElementById('metro-map-stations-canvas');
  var ctx = canvas.getContext('2d', {alpha: true});
  ctx.font = '700 20px sans-serif';

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (var x in metroMap){
    for (var y in metroMap[x]) {
      x = parseInt(x);
      y = parseInt(y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        continue;
      }
      drawStation(ctx, x, y, metroMap);
    } // for y
  } // for x

  // Add a map credit to help promote the site
  ctx.font = '700 20px sans-serif';
  ctx.fillStyle = '#000000';
  var mapCredit = 'Created with MetroMapMaker.com';
  var textWidth = ctx.measureText(mapCredit).width;
  ctx.fillText(mapCredit, (gridRows * gridPixelMultiplier) - textWidth, (gridCols * gridPixelMultiplier) - 50);

  // Has a shareable link been created for this map? If so, add it to the corner
  var shareableLink = document.getElementById('shareable-map-link');
  if (shareableLink) {
    shareableLink = shareableLink.text;
    if (shareableLink.length > 0 && shareableLink.slice(0, 26) == "https://metromapmaker.com/") {
      var remixCredit = 'Remix this map! Go to ' + shareableLink;
      var textWidth = ctx.measureText(remixCredit).width;
      ctx.fillText(remixCredit, (gridRows * gridPixelMultiplier) - textWidth, (gridCols * gridPixelMultiplier) - 25);
    }
  }
} // drawCanvas(metroMap)

function drawPoint(ctx, x, y, metroMap, erasedLine) {
  // Draw a single point at position x, y

  var activeLine = getActiveLine(x, y, metroMap);

  ctx.beginPath();

  if (!lastStrokeStyle || lastStrokeStyle != activeLine) {
    // Making state changes to the canvas is expensive
    // So only change it if there is no lastStrokeStyle,
    // or if the lastStrokeStyle doesn't match the activeLine
    ctx.strokeStyle = '#' + activeLine;
    lastStrokeStyle = activeLine;
  }

  if (erasedLine) {
    // Repurpose drawPoint() for erasing; use in drawArea()
    ctx.strokeStyle = '#ffffff';
    activeLine = erasedLine;
  }

  singleton = true;

  // Diagonals
  if (activeLine == getActiveLine(x + 1, y + 1, metroMap)) {
    // Direction: SE
    moveLineStroke(ctx, x, y, x+1, y+1);
    if (activeLine != getActiveLine(x + 1, y, metroMap) && getActiveLine(x + 1, y, metroMap)) {
      // If this southeast line is adjacent to a different color on its east,
      //  redraw these overlapping points later
      if (!redrawOverlappingPoints[x]) {
        redrawOverlappingPoints[x] = {}
      }
      redrawOverlappingPoints[x][y] = true;
    }
  } if (activeLine == getActiveLine(x - 1, y - 1, metroMap)) {
    // Direction: NW
    // Since the drawing goes left -> right, top -> bottom,
    //  I don't need to draw NW if I've drawn SE
    //  I used to cut down on calls to getActiveLine() and moveLineStroke()
    //  by just directly setting/getting singleton.
    // But now that I'm using drawPoint() inside of redrawArea(),
    // I can't rely on this shortcut anymore.
    moveLineStroke(ctx, x, y, x-1, y-1);
  } if (activeLine == getActiveLine(x + 1, y - 1, metroMap)) {
    // Direction: NE
    moveLineStroke(ctx, x, y, x+1, y-1);
  }  if (activeLine == getActiveLine(x - 1, y + 1, metroMap)) {
    // Direction: SW
    moveLineStroke(ctx, x, y, x-1, y+1);
  }

  // Cardinals
  if (activeLine == getActiveLine(x + 1, y, metroMap)) {
    // Direction: E
    moveLineStroke(ctx, x, y, x+1, y);
  } if (activeLine == getActiveLine(x - 1, y, metroMap)) {
    // Direction: W
    moveLineStroke(ctx, x, y, x-1, y);
  } if (activeLine == getActiveLine(x, y + 1, metroMap)) {
    // Direction: S
    moveLineStroke(ctx, x, y, x, y+1);
  } if (activeLine == getActiveLine(x, y - 1, metroMap)) {
    // Direction: N
    moveLineStroke(ctx, x, y, x, y-1);
  }

  if (singleton) {
    // Without this, singletons with no neighbors won't be painted at all.
    // So map legends, "under construction", or similar lines should be painted.
    if (erasedLine) {
      ctx.fillStyle = '#ffffff';
    } else {
      ctx.fillStyle = '#' + activeLine;
    }
    ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * .9, 0, Math.PI * 2, true); // Rail-line circle
    ctx.fill();
  } else {
    // Doing one stroke at the end once all the lines are known
    //  rather than several strokes will improve performance
    ctx.stroke();
  }

  ctx.closePath();
} // drawPoint(ctx, x, y, metroMap)

function drawStation(ctx, x, y, metroMap) {
  var isStation = metroMap[x][y]["station"];
  if (isStation) {
    var isTransferStation = metroMap[x][y]["station"]["transfer"];
  } else {
    return; // If it's not a station, I can end here.
  }

  if (isTransferStation) {
    // Outer circle
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * 1.2, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    // Inner circle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * .9, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
  }

  // Outer circle
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * .6, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();

  // Inner circle
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * .3, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();

  // Write the station name
  ctx.fillStyle = '#000000';
  ctx.save();
  var activeStation = metroMap[x][y]["station"]["name"].replaceAll('_', ' ');

  // Rotate the canvas if specified in the station name orientation
  if (metroMap[x][y]["station"]["orientation"] == '-45') {
    ctx.translate(x * gridPixelMultiplier, y * gridPixelMultiplier);
    ctx.rotate(-45 * (Math.PI/ 180));
    if (isTransferStation) {
      ctx.fillText(activeStation, 30, 5);
    } else {
      ctx.fillText(activeStation, 15, 5);
    }
  } else if (metroMap[x][y]["station"]["orientation"] == '45') {
    ctx.translate(x * gridPixelMultiplier, y * gridPixelMultiplier);
    ctx.rotate(45 * (Math.PI/ 180));
    if (isTransferStation) {
      ctx.fillText(activeStation, 30, 5);
    } else {
      ctx.fillText(activeStation, 15, 5);
    }
  } else if (metroMap[x][y]["station"]["orientation"] == '135') {
    var textSize = ctx.measureText(activeStation).width;
    ctx.translate(x * gridPixelMultiplier, y * gridPixelMultiplier);
    ctx.rotate(-45 * (Math.PI/ 180));
    if (isTransferStation) {
      ctx.fillText(activeStation, -1 * textSize - 30, 5);
    } else {
      ctx.fillText(activeStation, -1 * textSize - 15, 5);
    }
  } else if (metroMap[x][y]["station"]["orientation"] == '180') {
    // When drawing on the left, this isn't very different from drawing on the right
    //      with no rotation, except that we measure the text first
    var textSize = ctx.measureText(activeStation).width;
    if (isTransferStation) {
      ctx.fillText(activeStation, (x * gridPixelMultiplier) - (gridPixelMultiplier * 1.5) - textSize, (y * gridPixelMultiplier) + gridPixelMultiplier / 4);
    } else {
      ctx.fillText(activeStation, (x * gridPixelMultiplier) - (gridPixelMultiplier) - textSize, (y * gridPixelMultiplier) + gridPixelMultiplier / 4);
    }
  } else  {
    if (isTransferStation) {
      ctx.fillText(activeStation, (x * gridPixelMultiplier) + (gridPixelMultiplier * 1.5), (y * gridPixelMultiplier) + gridPixelMultiplier / 4);
    } else {
      ctx.fillText(activeStation, (x * gridPixelMultiplier) + gridPixelMultiplier, (y * gridPixelMultiplier) + gridPixelMultiplier / 4);
    }
  } // else (of if station hasClass .rot-45)

  ctx.restore();
} // drawStation(ctx, x, y, metroMap)

function drawIndicator(x, y) {
  // Place a temporary station marker on the canvas;
  // this will be overwritten by the drawCanvas() call
  // but at least there will be some visual indicator of the station's placement
  // now that the grid squares aren't visible
  var canvas = document.getElementById('metro-map-stations-canvas');
  var ctx = canvas.getContext('2d', {alpha: false});
  var gridPixelMultiplier = canvas.width / gridCols;

  if (!getActiveLine(x, y)) {
    // If there is no activeLine, don't draw any symbol.
    // Stations must be placed on a line.
    return
  }

  if ($('#coord-x-' + x + '-y-' + y + ' .station').hasClass('transfer-station')) {
    // Outer circle
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * 1.2, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    // Inner circle
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * .9, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
  }

  // Outer circle
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * .6, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();

  // Inner circle
  ctx.fillStyle = '#00ff00'; // Bright green
  ctx.beginPath();
  ctx.arc(x * gridPixelMultiplier, y * gridPixelMultiplier, gridPixelMultiplier * .3, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();
} // drawIndicator(x, y)

function rgb2hex(rgb) {
    if (/^#[0-9A-F]{6}$/i.test(rgb)) return rgb;

    rgb = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    function hex(x) {
        return ("0" + parseInt(x).toString(16)).slice(-2);
    }
    return "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
} // rgb2hex(rgb)

function autoSave(metroMap) {
  // Saves the provided metroMap to localStorage
  if (typeof metroMap == 'object') {
    metroMap = JSON.stringify(metroMap);
  }
  window.localStorage.setItem('metroMap', metroMap);

  $('#autosave-indicator').html('<i class="fa fa-spinner fa-spin" aria-hidden="true"></i> Saving ...');
  setTimeout(function() {
    $('#autosave-indicator').html('');
  }, 1500)
} // autoSave(metroMap)

function getURLParameter(name) {
    return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search) || [null, ''])[1].replace(/\+/g, '%20')) || null;
}

function autoLoad() {
  // Attempts to load a saved map, in the order:
  // 1. from a URL parameter 'map' with a valid map hash
  // 2. from a map object saved in localStorage
  // 3. If neither 1 or 2, load a preset map (WMATA)
  var savedMapHash = getURLParameter('map');
  if (savedMapHash) {
    $.get('/load/' + savedMapHash).done(function (savedMapData) {
      savedMapData = savedMapData.replaceAll(" u&#39;", "'").replaceAll("{u&#39;", '{"').replaceAll("\\[u&#39;", '["').replaceAll('&#39;', '"').replaceAll("'", '"').replaceAll('\\\\x', '&#x');
      if (savedMapData.replace(/\s/g,'').slice(0,7) == '[ERROR]') {
        // Fallback to an empty grid
        drawGrid();
        bindRailLineEvents();
        drawCanvas();
      } else {
        getMapSize(savedMapData);
        loadMapFromObject(JSON.parse(savedMapData));
      }
    });
  } else if (window.localStorage.getItem('metroMap')) {
    // Load from local storage
    savedMapData = JSON.parse(window.localStorage.getItem('metroMap'));
    getMapSize(savedMapData);
    loadMapFromObject(savedMapData);
  } else {
    // If no map URLParameter and no locally stored map, default to the WMATA map
    // I think this would be more intuitive than the blank slate,
    //    and might limit the number of blank / red-squiggle maps created.
    // If the WMATA map ever changes, I'll need to update it here too.
    $.get('/load/s8JC8_z0').done(function (savedMapData) {
      savedMapData = savedMapData.replaceAll(" u&#39;", "'").replaceAll("{u&#39;", '{"').replaceAll("\\[u&#39;", '["').replaceAll('&#39;', '"').replaceAll("'", '"').replaceAll('\\\\x', '&#x');
      if (savedMapData.replace(/\s/g,'').slice(0,7) == '[ERROR]') {
        // Fallback to an empty grid
        drawGrid();
        bindRailLineEvents();
        drawCanvas();
      } else {
        getMapSize(savedMapData);
        loadMapFromObject(JSON.parse(savedMapData));
      }
    });
  }
  setTimeout(function() {
    $('#tool-resize-' + gridRows).text('Initial size (' + gridRows + 'x' + gridCols + ')');
  }, 1000);
} // autoLoad()

function getMapSize(metroMapObject) {
  // Sets gridRows and gridCols based on how far to the right map features have been placed
  // A map with x,y values within 0-79 will shrink to an 80x80 grid even if
  //    the grid has been extended beyond that
    var highestValue = 0;
    if (typeof metroMapObject !== 'object') {
      metroMapObject = JSON.parse(metroMapObject);
    }
    for (var x in metroMapObject) {
      for (var y in metroMapObject[x]) {
        x = parseInt(x);
        y = parseInt(y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || !metroMapObject[x][y]) {
          continue;
        }
        if (x > highestValue) {
          highestValue = x;
        }
        if (y > highestValue) {
          highestValue = y;
        }
      } // for var y
    } // for var x

    // If adding new map sizes, edit this!
    if (highestValue >= 200) {
      gridRows = 240, gridCols = 240;
    } else if (highestValue >= 160) {
      gridRows = 200, gridCols = 200;
    } else if (highestValue >= 120) {
      gridRows = 160, gridCols = 160;
    } else if (highestValue >= 80) {
      gridRows = 120, gridCols = 120;
    } else {
      gridRows = 80, gridCols = 80;
    }
} // getMapSize(metroMapObject)

function loadMapFromObject(metroMapObject, update) {
  // Loads a map from the provided metroMapObject and 
  //  applies the necessary styling to the grid
  if (typeof metroMapObject != 'object') {
    metroMapObject = JSON.parse(metroMapObject);
  }

  if (!update) {
    drawGrid();
  }

  for (var x in metroMapObject) {
    if (metroMapObject.hasOwnProperty(x)) {
      for (var y in metroMapObject[x]) {
        if (metroMapObject[x].hasOwnProperty(y)) {
          $('#coord-x-' + x + '-y-' + y).addClass('has-line');
          $('#coord-x-' + x + '-y-' + y).addClass('has-line-' + metroMapObject[x][y]['line']);
          if (metroMapObject[x][y]["station"]) {
            $('#coord-x-' + x + '-y-' + y).addClass('has-station');
            $('#coord-x-' + x + '-y-' + y).html('<div id="' + metroMapObject[x][y]["station"]["name"] +'" class="station"></div>');
            if (metroMapObject[x][y]["station"]["transfer"] == 1) {
              $('#' + metroMapObject[x][y]["station"]["name"]).addClass('transfer-station');
            }
            if (metroMapObject[x][y]["station"]["lines"] && metroMapObject[x][y]['station']['name']) {
              for (var z=0; z<metroMapObject[x][y]["station"]["lines"].length; z++) {
                $('#' + metroMapObject[x][y]["station"]["name"]).addClass('has-line-' + metroMapObject[x][y]["station"]["lines"][z]);
              } // for lines
              if (metroMapObject[x][y]["station"]["orientation"] == '180') {
                $('#' + metroMapObject[x][y]["station"]["name"]).addClass('rot180');
              } else if (metroMapObject[x][y]["station"]["orientation"] == '-45') {
                $('#' + metroMapObject[x][y]["station"]["name"]).addClass('rot-45');
              } else if (metroMapObject[x][y]["station"]["orientation"] == '45') {
                $('#' + metroMapObject[x][y]["station"]["name"]).addClass('rot45');
              } else if (metroMapObject[x][y]["station"]["orientation"] == '135') {
                $('#' + metroMapObject[x][y]["station"]["name"]).addClass('rot135');
              } // if station orientation
            } // if station name, lines
          } // if station
        } // if y
      } // for y in x
    } // if x
  } // for x in map

  if (!update) {
    if (Object.keys(metroMapObject['global']['lines']).length > 0) {
      // Remove original rail lines if the map has its own preset rail lines
      $('#tool-line-options button.original-rail-line').remove();
    }

    for (var line in metroMapObject['global']['lines']) {
      if (metroMapObject['global']['lines'].hasOwnProperty(line) && document.getElementById('rail-line-' + line) === null) {
          $('#rail-line-new').before('<button id="rail-line-' + line + '" class="rail-line btn-info" style="background-color: #' + line + ';">' + metroMapObject['global']['lines'][line]['displayName'] + '</button>');
      }
    }

    $(function () {
      $('[data-toggle="tooltip"]').tooltip({"container": "body"});
      bindRailLineEvents();
      drawCanvas(metroMapObject);
      var savedMapHash = getURLParameter('map');
      if ($('.visible-xs').is(':visible') && savedMapHash) {
        // If visiting a specific map on mobile,
        // it's a poor experience to display the generic
        // #favorite-maps rather than the specific map you came to see

        $('#favorite-maps').hide();
        $('#canvas-container').removeClass('hidden-xs');
        $('#tool-export-canvas').click();
        $('#try-on-mobile').attr('disabled', false);

      } // if visible-xs && savedMapHash
    }); // Do this here because it looks like the call to this below doesn't happen in time to load all the tooltips created by the map being loaded
  } // if !update
} // loadMapFromObject(metroMapObject)

function updateMapObject(x, y, activeTool) {
  // Intended to be a faster version of saveMapAsObject()
  // Instead of reconsituting the whole map object,
  //  just update what's at x,y

  if (activeMap) {
    var metroMap = activeMap;
  } else {
    // Don't request from localStorage unless we have to
    var metroMap = JSON.parse(window.localStorage.getItem('metroMap'));
  }

  if (activeTool == 'eraser') {
    if (!metroMap[x] || !metroMap[x][y]) {
      // Don't delete coordinates that have nothing there already
    } else {
      delete metroMap[x][y];
    }
    return metroMap;
  }

  var classes = document.getElementById('coord-x-' + x + '-y-' + y).className.split(' ');

  if (!metroMap.hasOwnProperty(x)) {
    metroMap[x] = {};
    metroMap[x][y] = {};
  } else {
    if (!metroMap[x].hasOwnProperty(y)) {
      metroMap[x][y] = {};
    }
  }

  activeLine = getActiveLine(x, y);
  metroMap[x][y]["line"] = activeLine;

  // Stations must exist on a line in order to be valid.
  if (classes.indexOf('has-station') >= 0) {
    var stationLines = getStationLines(x, y);
    var activeStation = document.getElementById('coord-x-' + x + '-y-' + y).children[0].id;
    if (activeStation) {
      // Stations must have a name in order to be valid.
        metroMap[x][y]['station'] = {
        'name': activeStation,
        'lines': stationLines
      }
      if ($('#' + activeStation).hasClass('transfer-station')) {
        metroMap[x][y]['station']['transfer'] = 1;
      } // if transfer station
      if ($('#' + activeStation).hasClass('rot180')) {
        metroMap[x][y]['station']['orientation'] = '180';
      } else if ($('#' + activeStation).hasClass('rot-45')) {
        metroMap[x][y]['station']['orientation'] = '-45';
      } else if ($('#' + activeStation).hasClass('rot45')) {
        metroMap[x][y]['station']['orientation'] = '45';
      } else if ($('#' + activeStation).hasClass('rot135')) {
        metroMap[x][y]['station']['orientation'] = '135';
      } else {
        metroMap[x][y]['station']['orientation'] = '0';
      }
    } // if station name
  } // if has-station

  return metroMap;
} // updateMapObject()

function saveMapAsObject() {
  // Based on the styling of grid squares, saves the map as an object
  // ultimately so it can be reconstituted with loadMapFromObject()

  metroMap = new Object();

  var squaresWithLines = document.getElementsByClassName("has-line");
  for (var square=0; square<squaresWithLines.length; square++) {

    var squareId = squaresWithLines[square].id.split("-");
    var x = squareId.slice(2,3);
    var y = squareId.slice(4);

    // Example: ["grid-col", "has-line", "has-line-f0ce15", "has-station"]
    var classes = squaresWithLines[square].className.split(' ');

    if (!metroMap.hasOwnProperty(x)) {
      metroMap[x] = {};
      metroMap[x][y] = {};
    } else {
      if (!metroMap[x].hasOwnProperty(y)) {
        metroMap[x][y] = {};
      }
    }

    activeLine = getActiveLine(x, y);
    metroMap[x][y]['line'] = activeLine;

    // Stations must exist on a line in order to be valid.
    if (classes.indexOf('has-station') >= 0) {
      var stationLines = getStationLines(x, y);
      var activeStation = document.getElementById('coord-x-' + x + '-y-' + y).children[0].id;
      if (activeStation) {
        // Stations must have a name in order to be valid.
          metroMap[x][y]['station'] = {
          'name': activeStation,
          'lines': stationLines
        }
        if ($('#' + activeStation).hasClass('transfer-station')) {
          metroMap[x][y]['station']['transfer'] = 1;
        } // if transfer station
        if ($('#' + activeStation).hasClass('rot180')) {
          metroMap[x][y]['station']['orientation'] = '180';
        } else if ($('#' + activeStation).hasClass('rot-45')) {
          metroMap[x][y]['station']['orientation'] = '-45';
        } else if ($('#' + activeStation).hasClass('rot45')) {
          metroMap[x][y]['station']['orientation'] = '45';
        } else if ($('#' + activeStation).hasClass('rot135')) {
          metroMap[x][y]['station']['orientation'] = '135';
        } else {
          metroMap[x][y]['station']['orientation'] = '0';
        }
      } // if station name
    } // if has-station
  } // for square in squaresWithLines

  // Save the names of the rail lines
  metroMap['global'] = new Object();
  metroMap['global']['lines'] = new Object();
  $('.rail-line').each(function() {
    if ($(this).attr('id') != 'rail-line-new') {
      // rail-line-
      metroMap['global']['lines'][$(this).attr('id').slice(10, 16)] = {
        'displayName': $(this).text()
      }
    }
  });

  return metroMap;
} // saveMapAsObject()

function moveMap(direction) {
    // Much faster and easier to read replacement
    //  of the old method of moving the map

    var xOffset = 0;
    var yOffset = 0;

    if (direction == 'left') {
        var xOffset = -1;
    } else if (direction == 'right') {
        var xOffset = 1;
    } else if (direction == 'down') {
        var yOffset = 1;
    } else if (direction == 'up') {
        var yOffset = -1;
    }

    var gridSize = window.getComputedStyle(document.getElementById('coord-x-0-y-0')).width.split("px")[0];

    newMapObject = {}
    for (var x in activeMap) {
      for (var y in activeMap[x]) {
        x = parseInt(x);
        y = parseInt(y);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          continue;
        }

        if (!newMapObject[x + xOffset]) {
            newMapObject[x + xOffset] = {}
        }

        // If x,y is within the boundaries
        if ((0 <= x && x < gridCols && 0 <= y && y < gridCols)) {

          // If the next square is within the boundaries
          if (0 <= x + xOffset && x + xOffset < gridCols && 0 <= y + yOffset && y + yOffset < gridCols) {
            newMapObject[x + xOffset][y + yOffset] = activeMap[x][y];
          }

          // Remove all classes from current grid item (except .grid-col)
          var classes = document.getElementById('coord-x-' + x + '-y-' + y).className.split(/\s+/);

          for (var c=0; c<classes.length; c++) {
            if (classes[c] != 'grid-col') {
              // Don't remove .grid-col or you'll have to re-bind all of the .grid-col events
              $('#coord-x-' + x + '-y-' + y).removeClass(classes[c]);
            } // if not .grid-col
          } // for classes

          // Delete old children (stations), otherwise there will be multiple items with this station ID, and that causes major problems.
          $('#coord-x-' + x + '-y-' + y).html('');
        } // within boundaries
      } // for y
    } // for x
    newMapObject["global"] = activeMap["global"];

    activeMap = newMapObject;
    loadMapFromObject(activeMap, true);
    setSquareSize(gridSize);
    drawCanvas();
} // moveMap(direction)

function disableRightClick(event) {
  // Sometimes when creating a map it's too easy to accidentally right click and it's annoying
  event.preventDefault();
}

$(document).ready(function() {

  // Bind to the mousedown and mouseup events so we can implement dragging easily
  mouseIsDown = false;
  $(document).mousedown(function() {
      mouseIsDown = true;
  }).mouseup(function() {
      mouseIsDown = false;
  });

  autoLoad();

  $('.start-hidden').each(function() {
    $(this).hide();
  })

  // Disable right-click on the grid (but not on the canvas/image)
  document.getElementById('grid').addEventListener('contextmenu', disableRightClick);

  // Enable the tooltips
  $(function () {
    $('[data-toggle="tooltip"]').tooltip({"container": "body"});
  })

  activeTool = 'look';

  $('#toolbox button').click(function() {
    $('#toolbox button').removeClass('btn-primary').addClass('btn-info');
    $(this).removeClass('btn-info');
    $(this).addClass('btn-primary')
  })

  // Toolbox
  $('#tool-line').click(function() {
    // Expand Rail line options
    if ($('#tool-line-options').is(':visible')) {
      $('#tool-line-options').hide();
      $('#tool-new-line-options').hide();
      $('#tool-line').html('<i class="fa fa-pencil" aria-hidden="true"></i><i class="fa fa-subway" aria-hidden="true"></i> Draw Rail Line');
    } else {
      $('#tool-line-options').show();
      $('#tool-line').html('<i class="fa fa-subway" aria-hidden="true"></i> Hide Rail Line options');
    }
    $('.tooltip').hide();
  }); // #tool-line.click() (Show rail lines you can paint)
  $('#rail-line-delete').click(function() {
    // Only delete lines that aren't in use
    var allLines = $('.rail-line');
    var linesToDelete = [];
    for (var a=0; a<allLines.length; a++) {
      if ($('.rail-line')[a].id != 'rail-line-new') {
        // Is this line in use at all?
        if ($('.has-line-' + $('.rail-line')[a].id.slice(10, 16)).length == 0) {
          linesToDelete.push($('#' + $('.rail-line')[a].id));
          // Also delete unused lines from the "Add lines this station serves" section
          linesToDelete.push($('#add-line-' + [a].id));
        }
      }
    }
    if (linesToDelete.length > 0) {
      for (var d=0; d<linesToDelete.length; d++) {
        linesToDelete[d].remove();
      }
    }
  }); // #rail-line-delete.click() (Delete unused lines)
  $('#tool-station').click(function() {
    activeTool = 'station';
    if ($('#tool-station-options').is(':visible')) {
      $('#tool-station-options').hide();
      $('#tool-station').html('<i class="fa fa-map-pin" aria-hidden="true"></i> Add/Edit Station');
    }
    $('.tooltip').hide();
  }); // #tool-station.click()
  $('#tool-eraser').click(function() {
    activeTool = 'eraser';
    $('#tool-station-options').hide();
    $('#tool-station').html('<i class="fa fa-map-pin" aria-hidden="true"></i> Add/Edit Station');
    $('.tooltip').hide();
  }); // #tool-eraser.click()
  $('#tool-grid').click(function() {
    if ($('#grid').hasClass('hide-gridlines')) {
      $('#grid').removeClass('hide-gridlines');
      $('#tool-grid').html('<i class="fa fa-table" aria-hidden="true"></i> Hide grid');
    } else {
      $('#grid').addClass('hide-gridlines');
      $('#tool-grid').html('<i class="fa fa-table" aria-hidden="true"></i> Show grid');
    }
  }); // #tool-grid.click() (Toggle grid visibility)
  $('#tool-zoom-in').click(function() {
    var gridSize = Math.floor(window.getComputedStyle(document.getElementById('coord-x-0-y-0')).width.split("px")[0]);
    if (gridSize < 50) {
      setSquareSize(parseInt(gridSize + 2));
      resizeCanvas();
      if ($('#tool-zoom-out').attr('disabled')) {
        $('#tool-zoom-out').attr('disabled', false);
      }
    } else {
      $(this).attr('disabled', true);
    }
  }); // #tool-zoom-in.click()
  $('#tool-zoom-out').click(function() {
    var gridSize = Math.floor(window.getComputedStyle(document.getElementById('coord-x-0-y-0')).width.split("px")[0]);
    if (gridSize > 8) {
      setSquareSize(parseInt(gridSize - 2));
      resizeCanvas();
      if ($('#tool-zoom-in').attr('disabled')) {
        $('#tool-zoom-in').attr('disabled', false);
      }
    } else {
      $(this).attr('disabled', true);
    }
  }); // #tool-zoom-out.click()
  $('#tool-resize-all').click(function() {
    if ($('#tool-resize-options').is(':visible')) {
      $('#tool-resize-options').hide();
      $('#tool-resize-all').html('<i class="fa fa-expand" aria-hidden="true"></i> Resize grid');
    } else {
      $('#tool-resize-options').show();
      $('#tool-resize-all').html('<i class="fa fa-expand" aria-hidden="true"></i> Hide Resize options');
    }
    $('.tooltip').hide();
  }); // #tool-resize-all.click()
  $('.resize-grid').click(function() {
    size = $(this).attr('id').split('-').slice(2);
    // Indicate which size the map is now sized to, and reset any other buttons
    $('.resize-grid').each(function() {
      if ($(this).html().split(' ')[0] == 'Current') {
        var resizeButtonSize = $(this).attr('id').split('-').slice(2);
        var resizeButtonLabel = '(' + resizeButtonSize + 'x' + resizeButtonSize + ')';
        if (resizeButtonSize == 80) {
          resizeButtonLabel = 'Standard ' + resizeButtonLabel;
        } else if (resizeButtonSize == 120) {
          resizeButtonLabel = 'Large ' + resizeButtonLabel;
        } else if (resizeButtonSize == 160) {
          resizeButtonLabel = 'Extra Large ' + resizeButtonLabel;
        } else if (resizeButtonSize == 200) {
          resizeButtonLabel = 'XXL ' + resizeButtonLabel;
        } else if (resizeButtonSize == 240) {
          resizeButtonLabel = 'XXXL ' + resizeButtonLabel;
        }
        $(this).html(resizeButtonLabel);
      }
    })
    $(this).html('Current Size (' + size + 'x' + size + ')');
    resizeGrid(size);
  }); // .resize-grid.click()
  $('#tool-move-all').click(function() {
    if ($('#tool-move-options').is(':visible')) {
      $('#tool-move-options').hide();
      $('#tool-move-all').html('<i class="fa fa-arrows" aria-hidden="true"></i> Move map')
    } else {
      $('#tool-move-options').show();
      $('#tool-move-all').html('<i class="fa fa-arrows" aria-hidden="true"></i> Hide Move options')
    }
    $('.tooltip').hide();
  }); // #tool-move-all.click()
  $('#tool-move-up').click(function() {
    moveMap("up");
  }); // #tool-move-up.click()
  $('#tool-move-down').click(function() {
    moveMap("down");
  }); // #tool-move-down.click()
  $('#tool-move-left').click(function() {
    moveMap("left");
  }); // #tool-move-left.click()
  $('#tool-move-right').click(function() {
    moveMap("right");
  }); // #tool-move-right.click()
  $('#tool-save-map').click(function() {
    activeTool = 'look';
    var savedMap = JSON.stringify(saveMapAsObject());
    autoSave(savedMap);
    var saveMapURL = '/save/';
    $.post( saveMapURL, {
      'metroMap': savedMap
    }).done(function(data) {
      if (data.replace(/\s/g,'').slice(0,7) == '[ERROR]') {
        $('#tool-save-options').html('<h5 class="danger">Sorry, there was a problem saving your map.</h5>');
        $('#tool-save-options').show();
      } else {
        data = data.split(',');
        var urlhash = data[0].replace(/\s/g,'');
        var namingToken = data[1].replace(/\s/g,'');
        var toolSaveOptions = '<h5 style="overflow-x: hidden;">Map Saved! You can share your map with a friend by using this link: <a id="shareable-map-link" href="/?map=' + urlhash + '" target="_blank">https://metromapmaker.com/?map=' + urlhash + '</a></h5> <h5>You can then share this URL with a friend - and they can remix your map without you losing your original! If you make changes to this map, click Save and Share again to get a new URL.</h5>';
        if (namingToken) {
          // Only show the naming form if the map could actually be renamed.
          toolSaveOptions += '<form id="name-map"><input type="hidden" name="urlhash" value="' + urlhash + '"><input type="hidden" name="naming_token" value="' + namingToken + '"><label for="name">Where is this a map of?</label><input type="text" name="name"><select name="tags"><option value="">What kind of map is this?</option><option value="real">This is a real metro system</option><option value="speculative">This is a real place, but a fantasy map</option><option value="unknown">This is an imaginary place</option></select></form><button id="name-this-map" class="btn btn-warning">Name this map</button>'
        }
        $('#tool-save-options').html(toolSaveOptions);
        $('#name-map').submit(function(e) {
          e.preventDefault();
        });
        $('#name-this-map').click(function(e) {
          var formData = $('#name-map').serializeArray().reduce(function(obj, item) {
              obj[item.name] = item.value;
              return obj;
          }, {});

          $.post('/name/', formData, function() {
            $('#name-map').hide();
            $('#name-this-map').removeClass('btn-warning');
            $('#name-this-map').addClass('btn-success');
            $('#name-this-map').text('Thanks!')
            setTimeout(function() {
              $('#name-this-map').hide();
            }, 500);
          });
        }) // #name-this-map.click()
        $('#tool-save-options').show();
      }
    });
    $('.tooltip').hide();
  }); // $('#tool-save-map').click()
  $('#tool-export-canvas').click(function() {
    activeTool = 'look';
    drawCanvas();
    $('#tool-station-options').hide();
    $('#tool-station').html('<i class="fa fa-map-pin" aria-hidden="true"></i> Add/Edit Station');

    $('.tooltip').hide();
    if ($('#grid').is(':visible')) {
      $('#grid').hide();
      $('#metro-map-canvas').hide();
      $('#metro-map-stations-canvas').hide();
      var canvas = document.getElementById('metro-map-canvas');
      var canvasStations = document.getElementById('metro-map-stations-canvas');
      // Layer the stations on top of the canvas
      var ctx = canvas.getContext('2d', {alpha: false});
      ctx.drawImage(canvasStations, 0, 0);
      $("#metro-map-image").attr("src", canvas.toDataURL());
      $("#metro-map-image").show();
      $('#export-canvas-help').show();
      $('button').attr('disabled', true);
      $(this).attr('disabled', false);
      $('#tool-export-canvas').html('<i class="fa fa-pencil-square-o" aria-hidden="true"></i> Edit map');
      $(this).attr('title', "Go back to editing your map").tooltip('fixTitle').tooltip('show');
    } else {
      $('#grid').show();
      $('#metro-map-canvas').show();
      $('#metro-map-stations-canvas').show();
      $("#metro-map-image").hide();
      $('#export-canvas-help').hide();
      $('button').attr('disabled', false);
      $('#tool-export-canvas').html('<i class="fa fa-file-image-o" aria-hidden="true"></i> Download as image');
      $(this).attr('title', "Download your map to share with friends").tooltip('fixTitle').tooltip('show');
    }
    // Hide the changed tooltip after a moment
    setTimeout(function() {
      $('.tooltip').hide();
    }, 1500);
  }); // #tool-export-canvas.click()
  $('#tool-clear-map').click(function() {
    // This will go faster if I set the grid size to 80x80 before clearing
    gridRows = 80, gridCols = 80;
    drawGrid();
    $('.tooltip').hide();
  }); // #tool-clear-map.click()

  $('#create-new-rail-line').click(function() {

    $('#new-rail-line-name').val($('#new-rail-line-name').val().replaceAll('<', '').replaceAll('>', '').replaceAll('"', '').replaceAll('\\\\', '').replaceAll('&', '&amp;').replaceAll('/', '&#x2f;').replaceAll("'", '&#27;'));

    var allColors = [], allNames = [];
    $('.rail-line').each(function() {
      allColors.push($(this).attr('id').slice(10, 16));
      allNames.push($(this).text());
    });

    if ($('#new-rail-line-color').val() == '') {
      // If a color has not been selected, the line can be created but is undefined.
      // Set it to black instead since that's the default
      $('#new-rail-line-color').val('#000000');
    }

    if (allColors.indexOf($('#new-rail-line-color').val().slice(1, 7)) >= 0) {
      $('#tool-new-line-errors').text('This color already exists! Please choose a new color.');
    } else if (allNames.indexOf($('#new-rail-line-name').val()) >= 0) {
      $('#tool-new-line-errors').text('This rail line name already exists! Please choose a new name.');
    } else if ($('#new-rail-line-name').val().length == 0) {
      $('#tool-new-line-errors').text('This rail line name cannot be blank. Please enter a name.');
    } else if ($('.rail-line').length > 99) {
      $('#tool-new-line-errors').text('Too many rail lines! Delete your unused ones before creating new ones.');
    } else {
      $('#tool-new-line-errors').text('');
      $('#rail-line-new').before('<button id="rail-line-' + $('#new-rail-line-color').val().slice(1, 7) + '" class="rail-line btn-info" style="background-color: ' + $('#new-rail-line-color').val() + ';">' + $('#new-rail-line-name').val() + '</button>');
      metroMap = saveMapAsObject();
      activeMap = metroMap;
      autoSave(metroMap);
    }
    // Re-bind events to .rail-line -- otherwise, newly created lines won't have events
    bindRailLineEvents();
  }); // $('#create-new-rail-line').click()

  $('#station-name').change(function() {
    // Remove characters that are invalid for an HTML element ID
    $(this).val($(this).val().replace(/[^A-Za-z0-9\- ]/g, ''));

    var x = $('#station-coordinates-x').val();
    var y = $('#station-coordinates-y').val();
    if (x >= 0 && y >= 0 ) {
      $('#coord-x-' + x + '-y-' + y + ' .station').attr('id', $('#station-name').val().replaceAll(' ', '_'));
    }

    metroMap = saveMapAsObject();
    autoSave(metroMap);
    drawCanvas(metroMap, true);
  }); // $('#station-name').change()

  $('#station-name-orientation').change(function() {
    var x = $('#station-coordinates-x').val();
    var y = $('#station-coordinates-y').val();

    $('#coord-x-' + x + '-y-' + y + ' .station').removeClass('rot45').removeClass('rot-45').removeClass('rot180').removeClass('rot135');

    if (x >= 0 && y >= 0) {
      if ($(this).val() == '0') {
        // Default orientation, no class needed.
      } else if ($(this).val() == '-45') {
        $('#coord-x-' + x + '-y-' + y + ' .station').addClass('rot-45');
      } else if ($(this).val() == '45') {
        $('#coord-x-' + x + '-y-' + y + ' .station').addClass('rot45');
      } else if ($(this).val() == '180') {
        $('#coord-x-' + x + '-y-' + y + ' .station').addClass('rot180');
      } else if ($(this).val() == '135') {
        $('#coord-x-' + x + '-y-' + y + ' .station').addClass('rot135');
      }
    }

    window.localStorage.setItem('metroMapStationOrientation', $(this).val());
    metroMap = saveMapAsObject();
    autoSave(metroMap);
    drawCanvas(metroMap, true);
    drawIndicator(x, y);
  }); // $('#station-name-orientation').change()

  $('#station-transfer').click(function() {
    var x = $('#station-coordinates-x').val();
    var y = $('#station-coordinates-y').val();
    if (x >= 0 && y >= 0 ) {
      if ($(this).is(':checked')) {
         $('#coord-x-' + x + '-y-' + y + ' .station').addClass('transfer-station');
      } else {
         $('#coord-x-' + x + '-y-' + y + ' .station').removeClass('transfer-station');
      }
    }
    metroMap = saveMapAsObject();
    autoSave(metroMap);
    drawCanvas(metroMap, true);
    drawIndicator(x, y);
  }); // $('#station-transfer').click()
}); // document.ready()

// Cheat codes / Advanced map manipulations
function getSurroundingLine(x, y, metroMap) {
  // Returns a line color only if x,y has two neighbors
  //  with the same color going in the same direction
  x = parseInt(x)
  y = parseInt(y)
  if (getActiveLine(x-1, y, metroMap) && (getActiveLine(x-1, y, metroMap) == getActiveLine(x+1, y, metroMap))) {
    // Left and right match
    return getActiveLine(x-1, y, metroMap);
  } else if (getActiveLine(x, y-1, metroMap) && (getActiveLine(x, y-1, metroMap) == getActiveLine(x, y+1, metroMap))) {
    // Top and bottom match
    return getActiveLine(x, y-1, metroMap);
  } else if (getActiveLine(x-1, y-1, metroMap) && (getActiveLine(x-1, y-1, metroMap) == getActiveLine(x+1, y+1, metroMap))) {
    // Diagonal: \
    return getActiveLine(x-1, y-1, metroMap);
  } else if (getActiveLine(x-1, y+1, metroMap) && (getActiveLine(x-1, y+1, metroMap) == getActiveLine(x+1, y-1, metroMap))) {
    // Diagonal: /
    return getActiveLine(x-1, y+1, metroMap);
  }
  return false;
} // getSurroundingLine(x, y, metroMap)

function stretchMap(metroMapObject) {
  // Stretch out a map
  // First, loop through all the keys and multiply them by 2
  // Next, loop through all the spaces and check:
  //   is that space surrounded by similar neighbors?
  //   if so, set that space equal to the color of its neighbors

  if (!metroMapObject) {
    metroMapObject = saveMapAsObject();
  }

  var newMapObject = {};
  for (var x in metroMapObject) {
    for (var y in metroMapObject[x]) {
      x = parseInt(x);
      y = parseInt(y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        continue;
      }
      if (!newMapObject.hasOwnProperty(x * 2)) {
        newMapObject[x * 2] = {}
      }
      newMapObject[x * 2][y * 2] = metroMapObject[x][y];
    } // for y
  } // for x

  // Set the gridRows and gridCols
  getMapSize(newMapObject)

  // Fill in the newly created in-between spaces
  for (var x=1;x<gridRows;x++) {
    for (var y=1;y<gridCols;y++) {
      var surroundingLine = getSurroundingLine(x, y, newMapObject);
      if (surroundingLine) {
        if (!newMapObject.hasOwnProperty(x)) {
          newMapObject[x] = {}
        }
        newMapObject[x][y] = {
          "line": surroundingLine
        }
      } // if neighboringLine
    } // for y
  } // for x

  newMapObject["global"] = metroMapObject["global"];
  activeMap = newMapObject;
  loadMapFromObject(newMapObject);
  return newMapObject;
} // stretchMap(metroMapObject)

function enableRightClick() {
  document.getElementById('grid').removeEventListener('contextmenu', disableRightClick);
} // enableRightClick()

function combineMap(urlhash) {
  // Add the map at the urlhash to the existing map.
  // Existing map must not be overwritten by the new map.
  // I expect this will mostly be used to bring terrain into an existing map
  // but this will only work for maps that are exactly aligned, or they will look a bit silly
  $.get('/load/' + urlhash).done(function (savedMapData) {
    savedMapData = savedMapData.replaceAll(" u&#39;", "'").replaceAll("{u&#39;", '{"').replaceAll("\\[u&#39;", '["').replaceAll('&#39;', '"').replaceAll("'", '"').replaceAll('\\\\x', '&#x');
    if (savedMapData.replace(/\s/g,'').slice(0,7) == '[ERROR]') {
      console.log("[WARN] Can't combine that map!");
    } else {
      savedMapData = JSON.parse(savedMapData)

      for (var x in savedMapData) {
        for (var y in savedMapData[x]) {
          if (!activeMap[x]) {
            activeMap[x] = {y: savedMapData[x][y]}
          } else if (activeMap[x] && !activeMap[x][y]) {
            activeMap[x][y] = savedMapData[x][y]
          }
        } // for y
      } // for x

      // Must also add the globals, otherwise the map probably won't be saveable
      for (var line in savedMapData["global"]["lines"]) {
        if (!activeMap["global"]["lines"][line]) {
          activeMap["global"]["lines"][line] = savedMapData["global"]["lines"][line]
        }
      }

      getMapSize(activeMap);
      loadMapFromObject(activeMap); // Must load not with update in order to update the map lines
      drawCanvas();
    }
  });
} // combineMap(urlhash)

function replaceColors(color1, color2) {
    // Replaces all instances of color1 with color2.
    // If arguments are hex values, replaces the values only.
    // If arguments are objects with keys name and color, will replace the name as well.
    var savedMapData = JSON.stringify(activeMap);
    if (typeof color1 == 'string' && color1.match('[a-fA-F0-9]{6}') && color2.match('[a-fA-F0-9]{6}')) {
      savedMapData = savedMapData.replaceAll(color1, color2);
    } else if (typeof color1 == 'object') {
      if (color1.color && color2.color && color1.color.match('[a-fA-F0-9]{6}') && color2.color.match('[a-fA-F0-9]{6}')) {
        var color = color1.color;
        savedMapData = savedMapData.replaceAll(color1.color, color2.color);
      }
      if (color1.name && color2.name) {
        if (color) {
          $('#rail-line-' + color).text(color2.name)
        } else {
          console.log("Colors renamed; will be seen on reload.")
        }
        savedMapData = savedMapData.replaceAll(color1.name, color2.name);
      }
    } else {
      return
    }

    savedMapData = JSON.parse(savedMapData);
    activeMap = savedMapData;
    loadMapFromObject(savedMapData);
    drawCanvas();
    autoSave(savedMapData);
    $('#rail-line-delete').click();
} // replaceColors(color1, color2)

// Steer mobile users toward the gallery, for a better experience
$('#try-on-mobile').click(function() {
  $('#try-on-mobile').hide();
  $('#favorite-maps').hide();
  setSquareSize(12);
  resizeCanvas();
  $('#toolbox-mobile-hint').removeClass('hidden-xs');
  $('#controls').removeClass('hidden-xs');
  $('#canvas-container').removeClass('hidden-xs');
});