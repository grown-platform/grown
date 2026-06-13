var BoloClient = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // compiled/node_modules/villain/world/base.js
  var require_base = __commonJS({
    "compiled/node_modules/villain/world/base.js"(exports, module) {
      var BaseWorld;
      BaseWorld = class BaseWorld {
        constructor() {
          this.objects = [];
        }
        //### Basic object management
        // Calling `tick` processes a single simulation step.
        tick() {
          var j, len, obj, ref;
          ref = this.objects.slice(0);
          for (j = 0, len = ref.length; j < len; j++) {
            obj = ref[j];
            this.update(obj);
          }
        }
        // These are methods that allow low-level manipulation of the object list, while keeping it
        // properly sorted, and keeping object indices up-to-date. Unless you're doing something special,
        // you will want to use `spawn` and `destroy` instead.
        insert(obj) {
          var i, j, k, len, other, ref, ref1, ref2;
          ref = this.objects;
          for (i = j = 0, len = ref.length; j < len; i = ++j) {
            other = ref[i];
            if (obj.updatePriority > other.updatePriority) {
              break;
            }
          }
          this.objects.splice(i, 0, obj);
          for (i = k = ref1 = i, ref2 = this.objects.length; ref1 <= ref2 ? k < ref2 : k > ref2; i = ref1 <= ref2 ? ++k : --k) {
            this.objects[i].idx = i;
          }
          return obj;
        }
        remove(obj) {
          var i, j, ref, ref1;
          this.objects.splice(obj.idx, 1);
          for (i = j = ref = obj.idx, ref1 = this.objects.length; ref <= ref1 ? j < ref1 : j > ref1; i = ref <= ref1 ? ++j : --j) {
            this.objects[i].idx = i;
          }
          obj.idx = null;
          return obj;
        }
        //### Abstract methods
        // The `registerType` method registers a type of object with the world. It is usually called on
        // the prototype of the `World`.
        registerType(type) {
        }
        // An object is added to the world with `world.spawn(MyObject, params...);`. The first parameter
        // is the type of object to spawn, and further arguments will be passed to the `spawn` method of
        // the object itself.
        spawn(type, ...args) {
        }
        // With the `update` method, a single world object is updated and the proper events are emitted.
        // This is called in a loop from `tick`, which is what you usually want to call instead.
        update(obj) {
        }
        // To remove an object from the world, pass it to this `destroy` method.
        destroy(obj) {
        }
      };
      module.exports = BaseWorld;
    }
  });

  // compiled/node_modules/villain/world/net/local.js
  var require_local = __commonJS({
    "compiled/node_modules/villain/world/net/local.js"(exports, module) {
      var BaseWorld;
      var NetLocalWorld;
      BaseWorld = require_base();
      NetLocalWorld = class NetLocalWorld extends BaseWorld {
        spawn(type, ...args) {
          var obj;
          obj = this.insert(new type(this));
          obj.spawn(...args);
          obj.anySpawn();
          return obj;
        }
        update(obj) {
          obj.update();
          obj.emit("update");
          obj.emit("anyUpdate");
          return obj;
        }
        destroy(obj) {
          obj.destroy();
          obj.emit("destroy");
          obj.emit("finalize");
          this.remove(obj);
          return obj;
        }
      };
      module.exports = NetLocalWorld;
    }
  });

  // compiled/src/constants.js
  var require_constants = __commonJS({
    "compiled/src/constants.js"(exports) {
      exports.PIXEL_SIZE_WORLD = 8;
      exports.TILE_SIZE_PIXELS = 32;
      exports.TILE_SIZE_WORLD = exports.TILE_SIZE_PIXELS * exports.PIXEL_SIZE_WORLD;
      exports.MAP_SIZE_TILES = 256;
      exports.MAP_SIZE_PIXELS = exports.MAP_SIZE_TILES * exports.TILE_SIZE_PIXELS;
      exports.MAP_SIZE_WORLD = exports.MAP_SIZE_TILES * exports.TILE_SIZE_WORLD;
      exports.TICK_LENGTH_MS = 20;
    }
  });

  // compiled/src/map.js
  var require_map = __commonJS({
    "compiled/src/map.js"(exports) {
      var Base;
      var MAP_SIZE_TILES;
      var Map;
      var MapCell;
      var MapObject;
      var MapView;
      var Pillbox;
      var Start;
      var TERRAIN_TYPES;
      var createTerrainMap;
      var floor;
      var min;
      var round;
      ({ round, floor, min } = Math);
      ({ MAP_SIZE_TILES } = require_constants());
      TERRAIN_TYPES = [
        {
          ascii: "|",
          description: "building"
        },
        {
          ascii: " ",
          description: "river"
        },
        {
          ascii: "~",
          description: "swamp"
        },
        {
          ascii: "%",
          description: "crater"
        },
        {
          ascii: "=",
          description: "road"
        },
        {
          ascii: "#",
          description: "forest"
        },
        {
          ascii: ":",
          description: "rubble"
        },
        {
          ascii: ".",
          description: "grass"
        },
        {
          ascii: "}",
          description: "shot building"
        },
        {
          ascii: "b",
          description: "river with boat"
        },
        {
          ascii: "^",
          description: "deep sea"
        }
      ];
      createTerrainMap = function() {
        var j, len, results, type;
        results = [];
        for (j = 0, len = TERRAIN_TYPES.length; j < len; j++) {
          type = TERRAIN_TYPES[j];
          results.push(TERRAIN_TYPES[type.ascii] = type);
        }
        return results;
      };
      createTerrainMap();
      MapCell = class MapCell {
        constructor(map1, x1, y1) {
          this.map = map1;
          this.x = x1;
          this.y = y1;
          this.type = TERRAIN_TYPES["^"];
          this.mine = this.isEdgeCell();
          this.idx = this.y * MAP_SIZE_TILES + this.x;
        }
        // Get the cell at offset +dx+,+dy+ from this cell.
        // Most commonly used to get one of the neighbouring cells.
        // Will return a dummy deep sea cell if the location is off the map.
        neigh(dx, dy) {
          return this.map.cellAtTile(this.x + dx, this.y + dy);
        }
        // Check whether the cell is one of the give types.
        // The splat variant is significantly slower
        //isType: (types...) ->
        //  for type in types
        //    return yes if @type == type or @type.ascii == type
        //  no
        isType() {
          var i, j, ref, type;
          for (i = j = 0, ref = arguments.length; 0 <= ref ? j <= ref : j >= ref; i = 0 <= ref ? ++j : --j) {
            type = arguments[i];
            if (this.type === type || this.type.ascii === type) {
              return true;
            }
          }
          return false;
        }
        isEdgeCell() {
          return this.x <= 20 || this.x >= 236 || this.y <= 20 || this.y >= 236;
        }
        getNumericType() {
          var num;
          if (this.type.ascii === "^") {
            return -1;
          }
          num = TERRAIN_TYPES.indexOf(this.type);
          if (this.mine) {
            num += 8;
          }
          return num;
        }
        setType(newType, mine, retileRadius) {
          var hadMine, oldType;
          retileRadius || (retileRadius = 1);
          oldType = this.type;
          hadMine = this.mine;
          if (mine !== void 0) {
            this.mine = mine;
          }
          if (typeof newType === "string") {
            this.type = TERRAIN_TYPES[newType];
            if (newType.length !== 1 || this.type == null) {
              throw `Invalid terrain type: ${newType}`;
            }
          } else if (typeof newType === "number") {
            if (newType >= 10) {
              newType -= 8;
              this.mine = true;
            } else {
              this.mine = false;
            }
            this.type = TERRAIN_TYPES[newType];
            if (this.type == null) {
              throw `Invalid terrain type: ${newType}`;
            }
          } else if (newType !== null) {
            this.type = newType;
          }
          if (this.isEdgeCell()) {
            this.mine = true;
          }
          if (!(retileRadius < 0)) {
            return this.map.retile(this.x - retileRadius, this.y - retileRadius, this.x + retileRadius, this.y + retileRadius);
          }
        }
        // Helper for retile methods. Short-hand for notifying the view of a retile.
        // Also takes care of drawing mines.
        setTile(tx, ty) {
          if (this.mine && !(this.pill != null || this.base != null)) {
            ty += 10;
          }
          return this.map.view.onRetile(this, tx, ty);
        }
        // Retile this cell. See map#retile.
        retile() {
          if (this.pill != null) {
            return this.setTile(this.pill.armour, 2);
          } else if (this.base != null) {
            return this.setTile(16, 0);
          } else {
            switch (this.type.ascii) {
              case "^":
                return this.retileDeepSea();
              case "|":
                return this.retileBuilding();
              case " ":
                return this.retileRiver();
              case "~":
                return this.setTile(7, 1);
              case "%":
                return this.setTile(5, 1);
              case "=":
                return this.retileRoad();
              case "#":
                return this.retileForest();
              case ":":
                return this.setTile(4, 1);
              case ".":
                return this.setTile(2, 1);
              case "}":
                return this.setTile(8, 1);
              case "b":
                return this.retileBoat();
            }
          }
        }
        retileDeepSea() {
          var above, aboveLeft, aboveRight, below, belowLeft, belowRight, left, neighbourSignificance, right;
          neighbourSignificance = (dx, dy) => {
            var n;
            n = this.neigh(dx, dy);
            if (n.isType("^")) {
              return "d";
            }
            if (n.isType(" ", "b")) {
              return "w";
            }
            return "l";
          };
          above = neighbourSignificance(0, -1);
          aboveRight = neighbourSignificance(1, -1);
          right = neighbourSignificance(1, 0);
          belowRight = neighbourSignificance(1, 1);
          below = neighbourSignificance(0, 1);
          belowLeft = neighbourSignificance(-1, 1);
          left = neighbourSignificance(-1, 0);
          aboveLeft = neighbourSignificance(-1, -1);
          if (aboveLeft !== "d" && above !== "d" && left !== "d" && right === "d" && below === "d") {
            return this.setTile(10, 3);
          } else if (aboveRight !== "d" && above !== "d" && right !== "d" && left === "d" && below === "d") {
            return this.setTile(11, 3);
          } else if (belowRight !== "d" && below !== "d" && right !== "d" && left === "d" && above === "d") {
            return this.setTile(13, 3);
          } else if (belowLeft !== "d" && below !== "d" && left !== "d" && right === "d" && above === "d") {
            return this.setTile(12, 3);
          } else if (left === "w" && right === "d") {
            return this.setTile(14, 3);
          } else if (below === "w" && above === "d") {
            return this.setTile(15, 3);
          } else if (above === "w" && below === "d") {
            return this.setTile(16, 3);
          } else if (right === "w" && left === "d") {
            return this.setTile(17, 3);
          } else {
            return this.setTile(0, 0);
          }
        }
        retileBuilding() {
          var above, aboveLeft, aboveRight, below, belowLeft, belowRight, left, neighbourSignificance, right;
          neighbourSignificance = (dx, dy) => {
            var n;
            n = this.neigh(dx, dy);
            if (n.isType("|", "}")) {
              return "b";
            }
            return "o";
          };
          above = neighbourSignificance(0, -1);
          aboveRight = neighbourSignificance(1, -1);
          right = neighbourSignificance(1, 0);
          belowRight = neighbourSignificance(1, 1);
          below = neighbourSignificance(0, 1);
          belowLeft = neighbourSignificance(-1, 1);
          left = neighbourSignificance(-1, 0);
          aboveLeft = neighbourSignificance(-1, -1);
          if (aboveLeft === "b" && above === "b" && aboveRight === "b" && left === "b" && right === "b" && belowLeft === "b" && below === "b" && belowRight === "b") {
            return this.setTile(17, 1);
          } else if (right === "b" && above === "b" && below === "b" && left === "b" && aboveRight !== "b" && aboveLeft !== "b" && belowRight !== "b" && belowLeft !== "b") {
            return this.setTile(30, 1);
          } else if (right === "b" && above === "b" && below === "b" && left === "b" && aboveRight !== "b" && aboveLeft !== "b" && belowRight !== "b" && belowLeft === "b") {
            return this.setTile(22, 2);
          } else if (right === "b" && above === "b" && below === "b" && left === "b" && aboveRight !== "b" && aboveLeft === "b" && belowRight !== "b" && belowLeft !== "b") {
            return this.setTile(23, 2);
          } else if (right === "b" && above === "b" && below === "b" && left === "b" && aboveRight !== "b" && aboveLeft !== "b" && belowRight === "b" && belowLeft !== "b") {
            return this.setTile(24, 2);
          } else if (right === "b" && above === "b" && below === "b" && left === "b" && aboveRight === "b" && aboveLeft !== "b" && belowRight !== "b" && belowLeft !== "b") {
            return this.setTile(25, 2);
          } else if (aboveLeft === "b" && above === "b" && left === "b" && right === "b" && belowLeft === "b" && below === "b" && belowRight === "b") {
            return this.setTile(16, 2);
          } else if (above === "b" && aboveRight === "b" && left === "b" && right === "b" && belowLeft === "b" && below === "b" && belowRight === "b") {
            return this.setTile(17, 2);
          } else if (aboveLeft === "b" && above === "b" && aboveRight === "b" && left === "b" && right === "b" && belowLeft === "b" && below === "b") {
            return this.setTile(18, 2);
          } else if (aboveLeft === "b" && above === "b" && aboveRight === "b" && left === "b" && right === "b" && below === "b" && belowRight === "b") {
            return this.setTile(19, 2);
          } else if (left === "b" && right === "b" && above === "b" && below === "b" && aboveRight === "b" && belowLeft === "b" && aboveLeft !== "b" && belowRight !== "b") {
            return this.setTile(20, 2);
          } else if (left === "b" && right === "b" && above === "b" && below === "b" && belowRight === "b" && aboveLeft === "b" && aboveRight !== "b" && belowLeft !== "b") {
            return this.setTile(21, 2);
          } else if (above === "b" && left === "b" && right === "b" && below === "b" && belowRight === "b" && aboveRight === "b") {
            return this.setTile(8, 2);
          } else if (above === "b" && left === "b" && right === "b" && below === "b" && belowLeft === "b" && aboveLeft === "b") {
            return this.setTile(9, 2);
          } else if (above === "b" && left === "b" && right === "b" && below === "b" && belowLeft === "b" && belowRight === "b") {
            return this.setTile(10, 2);
          } else if (above === "b" && left === "b" && right === "b" && below === "b" && aboveLeft === "b" && aboveRight === "b") {
            return this.setTile(11, 2);
          } else if (above === "b" && below === "b" && left === "b" && right !== "b" && belowLeft === "b" && aboveLeft !== "b") {
            return this.setTile(12, 2);
          } else if (above === "b" && below === "b" && right === "b" && belowRight === "b" && left !== "b" && aboveRight !== "b") {
            return this.setTile(13, 2);
          } else if (above === "b" && below === "b" && right === "b" && aboveRight === "b" && belowRight !== "b") {
            return this.setTile(14, 2);
          } else if (above === "b" && below === "b" && left === "b" && aboveLeft === "b" && belowLeft !== "b") {
            return this.setTile(15, 2);
          } else if (right === "b" && above === "b" && left === "b" && below !== "b" && aboveLeft !== "b" && aboveRight !== "b") {
            return this.setTile(26, 1);
          } else if (right === "b" && below === "b" && left === "b" && belowLeft !== "b" && belowRight !== "b") {
            return this.setTile(27, 1);
          } else if (right === "b" && above === "b" && below === "b" && aboveRight !== "b" && belowRight !== "b") {
            return this.setTile(28, 1);
          } else if (below === "b" && above === "b" && left === "b" && aboveLeft !== "b" && belowLeft !== "b") {
            return this.setTile(29, 1);
          } else if (left === "b" && right === "b" && above === "b" && aboveRight === "b" && aboveLeft !== "b") {
            return this.setTile(4, 2);
          } else if (left === "b" && right === "b" && above === "b" && aboveLeft === "b" && aboveRight !== "b") {
            return this.setTile(5, 2);
          } else if (left === "b" && right === "b" && below === "b" && belowLeft === "b" && belowRight !== "b") {
            return this.setTile(6, 2);
          } else if (left === "b" && right === "b" && below === "b" && above !== "b" && belowRight === "b" && belowLeft !== "b") {
            return this.setTile(7, 2);
          } else if (right === "b" && above === "b" && below === "b") {
            return this.setTile(0, 2);
          } else if (left === "b" && above === "b" && below === "b") {
            return this.setTile(1, 2);
          } else if (right === "b" && left === "b" && below === "b") {
            return this.setTile(2, 2);
          } else if (right === "b" && above === "b" && left === "b") {
            return this.setTile(3, 2);
          } else if (right === "b" && below === "b" && belowRight === "b") {
            return this.setTile(18, 1);
          } else if (left === "b" && below === "b" && belowLeft === "b") {
            return this.setTile(19, 1);
          } else if (right === "b" && above === "b" && aboveRight === "b") {
            return this.setTile(20, 1);
          } else if (left === "b" && above === "b" && aboveLeft === "b") {
            return this.setTile(21, 1);
          } else if (right === "b" && below === "b") {
            return this.setTile(22, 1);
          } else if (left === "b" && below === "b") {
            return this.setTile(23, 1);
          } else if (right === "b" && above === "b") {
            return this.setTile(24, 1);
          } else if (left === "b" && above === "b") {
            return this.setTile(25, 1);
          } else if (left === "b" && right === "b") {
            return this.setTile(11, 1);
          } else if (above === "b" && below === "b") {
            return this.setTile(12, 1);
          } else if (right === "b") {
            return this.setTile(13, 1);
          } else if (left === "b") {
            return this.setTile(14, 1);
          } else if (below === "b") {
            return this.setTile(15, 1);
          } else if (above === "b") {
            return this.setTile(16, 1);
          } else {
            return this.setTile(6, 1);
          }
        }
        retileRiver() {
          var above, below, left, neighbourSignificance, right;
          neighbourSignificance = (dx, dy) => {
            var n;
            n = this.neigh(dx, dy);
            if (n.isType("=")) {
              return "r";
            }
            if (n.isType("^", " ", "b")) {
              return "w";
            }
            return "l";
          };
          above = neighbourSignificance(0, -1);
          right = neighbourSignificance(1, 0);
          below = neighbourSignificance(0, 1);
          left = neighbourSignificance(-1, 0);
          if (above === "l" && below === "l" && right === "l" && left === "l") {
            return this.setTile(30, 2);
          } else if (above === "l" && below === "l" && right === "w" && left === "l") {
            return this.setTile(26, 2);
          } else if (above === "l" && below === "l" && right === "l" && left === "w") {
            return this.setTile(27, 2);
          } else if (above === "l" && below === "w" && right === "l" && left === "l") {
            return this.setTile(28, 2);
          } else if (above === "w" && below === "l" && right === "l" && left === "l") {
            return this.setTile(29, 2);
          } else if (above === "l" && left === "l") {
            return this.setTile(6, 3);
          } else if (above === "l" && right === "l") {
            return this.setTile(7, 3);
          } else if (below === "l" && left === "l") {
            return this.setTile(8, 3);
          } else if (below === "l" && right === "l") {
            return this.setTile(9, 3);
          } else if (below === "l" && above === "l" && below === "l") {
            return this.setTile(0, 3);
          } else if (left === "l" && right === "l") {
            return this.setTile(1, 3);
          } else if (left === "l") {
            return this.setTile(2, 3);
          } else if (below === "l") {
            return this.setTile(3, 3);
          } else if (right === "l") {
            return this.setTile(4, 3);
          } else if (above === "l") {
            return this.setTile(5, 3);
          } else {
            return this.setTile(1, 0);
          }
        }
        retileRoad() {
          var above, aboveLeft, aboveRight, below, belowLeft, belowRight, left, neighbourSignificance, right;
          neighbourSignificance = (dx, dy) => {
            var n;
            n = this.neigh(dx, dy);
            if (n.isType("=")) {
              return "r";
            }
            if (n.isType("^", " ", "b")) {
              return "w";
            }
            return "l";
          };
          above = neighbourSignificance(0, -1);
          aboveRight = neighbourSignificance(1, -1);
          right = neighbourSignificance(1, 0);
          belowRight = neighbourSignificance(1, 1);
          below = neighbourSignificance(0, 1);
          belowLeft = neighbourSignificance(-1, 1);
          left = neighbourSignificance(-1, 0);
          aboveLeft = neighbourSignificance(-1, -1);
          if (aboveLeft !== "r" && above === "r" && aboveRight !== "r" && left === "r" && right === "r" && belowLeft !== "r" && below === "r" && belowRight !== "r") {
            return this.setTile(11, 0);
          } else if (above === "r" && left === "r" && right === "r" && below === "r") {
            return this.setTile(10, 0);
          } else if (left === "w" && right === "w" && above === "w" && below === "w") {
            return this.setTile(26, 0);
          } else if (right === "r" && below === "r" && left === "w" && above === "w") {
            return this.setTile(20, 0);
          } else if (left === "r" && below === "r" && right === "w" && above === "w") {
            return this.setTile(21, 0);
          } else if (above === "r" && left === "r" && below === "w" && right === "w") {
            return this.setTile(22, 0);
          } else if (right === "r" && above === "r" && left === "w" && below === "w") {
            return this.setTile(23, 0);
          } else if (above === "w" && below === "w") {
            return this.setTile(24, 0);
          } else if (left === "w" && right === "w") {
            return this.setTile(25, 0);
          } else if (above === "w" && below === "r") {
            return this.setTile(16, 0);
          } else if (right === "w" && left === "r") {
            return this.setTile(17, 0);
          } else if (below === "w" && above === "r") {
            return this.setTile(18, 0);
          } else if (left === "w" && right === "r") {
            return this.setTile(19, 0);
          } else if (right === "r" && below === "r" && above === "r" && (aboveRight === "r" || belowRight === "r")) {
            return this.setTile(27, 0);
          } else if (left === "r" && right === "r" && below === "r" && (belowLeft === "r" || belowRight === "r")) {
            return this.setTile(28, 0);
          } else if (left === "r" && above === "r" && below === "r" && (belowLeft === "r" || aboveLeft === "r")) {
            return this.setTile(29, 0);
          } else if (left === "r" && right === "r" && above === "r" && (aboveRight === "r" || aboveLeft === "r")) {
            return this.setTile(30, 0);
          } else if (left === "r" && right === "r" && below === "r") {
            return this.setTile(12, 0);
          } else if (left === "r" && above === "r" && below === "r") {
            return this.setTile(13, 0);
          } else if (left === "r" && right === "r" && above === "r") {
            return this.setTile(14, 0);
          } else if (right === "r" && above === "r" && below === "r") {
            return this.setTile(15, 0);
          } else if (below === "r" && right === "r" && belowRight === "r") {
            return this.setTile(6, 0);
          } else if (below === "r" && left === "r" && belowLeft === "r") {
            return this.setTile(7, 0);
          } else if (above === "r" && left === "r" && aboveLeft === "r") {
            return this.setTile(8, 0);
          } else if (above === "r" && right === "r" && aboveRight === "r") {
            return this.setTile(9, 0);
          } else if (below === "r" && right === "r") {
            return this.setTile(2, 0);
          } else if (below === "r" && left === "r") {
            return this.setTile(3, 0);
          } else if (above === "r" && left === "r") {
            return this.setTile(4, 0);
          } else if (above === "r" && right === "r") {
            return this.setTile(5, 0);
          } else if (right === "r" || left === "r") {
            return this.setTile(0, 1);
          } else if (above === "r" || below === "r") {
            return this.setTile(1, 1);
          } else {
            return this.setTile(10, 0);
          }
        }
        retileForest() {
          var above, below, left, right;
          above = this.neigh(0, -1).isType("#");
          right = this.neigh(1, 0).isType("#");
          below = this.neigh(0, 1).isType("#");
          left = this.neigh(-1, 0).isType("#");
          if (!above && !left && right && below) {
            return this.setTile(9, 9);
          } else if (!above && left && !right && below) {
            return this.setTile(10, 9);
          } else if (above && left && !right && !below) {
            return this.setTile(11, 9);
          } else if (above && !left && right && !below) {
            return this.setTile(12, 9);
          } else if (above && !left && !right && !below) {
            return this.setTile(16, 9);
          } else if (!above && !left && !right && below) {
            return this.setTile(15, 9);
          } else if (!above && left && !right && !below) {
            return this.setTile(14, 9);
          } else if (!above && !left && right && !below) {
            return this.setTile(13, 9);
          } else if (!above && !left && !right && !below) {
            return this.setTile(8, 9);
          } else {
            return this.setTile(3, 1);
          }
        }
        retileBoat() {
          var above, below, left, neighbourSignificance, right;
          neighbourSignificance = (dx, dy) => {
            var n;
            n = this.neigh(dx, dy);
            if (n.isType("^", " ", "b")) {
              return "w";
            }
            return "l";
          };
          above = neighbourSignificance(0, -1);
          right = neighbourSignificance(1, 0);
          below = neighbourSignificance(0, 1);
          left = neighbourSignificance(-1, 0);
          if (above !== "w" && left !== "w") {
            return this.setTile(15, 6);
          } else if (above !== "w" && right !== "w") {
            return this.setTile(16, 6);
          } else if (below !== "w" && right !== "w") {
            return this.setTile(17, 6);
          } else if (below !== "w" && left !== "w") {
            return this.setTile(14, 6);
          } else if (left !== "w") {
            return this.setTile(12, 6);
          } else if (right !== "w") {
            return this.setTile(13, 6);
          } else if (below !== "w") {
            return this.setTile(10, 6);
          } else {
            return this.setTile(11, 6);
          }
        }
      };
      MapView = class MapView {
        // Called every time a tile changes, with the tile reference and the new tile coordinates to use.
        // This is also called on Map#setView, once for every tile.
        onRetile(cell, tx, ty) {
        }
      };
      MapObject = class MapObject {
        constructor(map1, x1, y1) {
          this.map = map1;
          this.x = x1;
          this.y = y1;
          this.cell = this.map.cells[this.y][this.x];
        }
      };
      Pillbox = class Pillbox extends MapObject {
        constructor(map, x, y, owner_idx, armour, speed) {
          super(map, x, y);
          this.owner_idx = owner_idx;
          this.armour = armour;
          this.speed = speed;
        }
      };
      Base = class Base extends MapObject {
        constructor(map, x, y, owner_idx, armour, shells, mines) {
          super(map, x, y);
          this.owner_idx = owner_idx;
          this.armour = armour;
          this.shells = shells;
          this.mines = mines;
        }
      };
      Start = class Start extends MapObject {
        constructor(map, x, y, direction) {
          super(map, x, y);
          this.direction = direction;
        }
      };
      Map = (function() {
        class Map2 {
          // Initialize the map array.
          constructor() {
            var j, k, ref, ref1, row, x, y;
            this.view = new MapView();
            this.pills = [];
            this.bases = [];
            this.starts = [];
            this.cells = new Array(MAP_SIZE_TILES);
            for (y = j = 0, ref = MAP_SIZE_TILES; 0 <= ref ? j < ref : j > ref; y = 0 <= ref ? ++j : --j) {
              row = this.cells[y] = new Array(MAP_SIZE_TILES);
              for (x = k = 0, ref1 = MAP_SIZE_TILES; 0 <= ref1 ? k < ref1 : k > ref1; x = 0 <= ref1 ? ++k : --k) {
                row[x] = new this.CellClass(this, x, y);
              }
            }
          }
          setView(view) {
            this.view = view;
            return this.retile();
          }
          // Get the cell at the given tile coordinates, or return a dummy cell.
          cellAtTile(x, y) {
            var cell, ref;
            if (cell = (ref = this.cells[y]) != null ? ref[x] : void 0) {
              return cell;
            } else {
              return new this.CellClass(this, x, y, {
                isDummy: true
              });
            }
          }
          // Iterate over the map cells, either the complete map or a specific area.
          // The callback function will have each cell available as +this+.
          each(cb, sx, sy, ex, ey) {
            var j, k, ref, ref1, ref2, ref3, row, x, y;
            if (!(sx != null && sx >= 0)) {
              sx = 0;
            }
            if (!(sy != null && sy >= 0)) {
              sy = 0;
            }
            if (!(ex != null && ex < MAP_SIZE_TILES)) {
              ex = MAP_SIZE_TILES - 1;
            }
            if (!(ey != null && ey < MAP_SIZE_TILES)) {
              ey = MAP_SIZE_TILES - 1;
            }
            for (y = j = ref = sy, ref1 = ey; ref <= ref1 ? j <= ref1 : j >= ref1; y = ref <= ref1 ? ++j : --j) {
              row = this.cells[y];
              for (x = k = ref2 = sx, ref3 = ex; ref2 <= ref3 ? k <= ref3 : k >= ref3; x = ref2 <= ref3 ? ++k : --k) {
                cb(row[x]);
              }
            }
            return this;
          }
          // Clear the map, or a specific area, by filling it with deep sea tiles.
          // Note: this will not do any retiling!
          clear(sx, sy, ex, ey) {
            return this.each(function(cell) {
              cell.type = TERRAIN_TYPES["^"];
              return cell.mine = cell.isEdgeCell();
            }, sx, sy, ex, ey);
          }
          // Recalculate the tile cache for each cell, or for a specific area.
          retile(sx, sy, ex, ey) {
            return this.each(function(cell) {
              return cell.retile();
            }, sx, sy, ex, ey);
          }
          // Find the cell at the center of the 'painted' map area.
          findCenterCell() {
            var b, l, r, t, x, y;
            t = l = MAP_SIZE_TILES - 1;
            b = r = 0;
            this.each(function(c) {
              if (l > c.x) {
                l = c.x;
              }
              if (r < c.x) {
                r = c.x;
              }
              if (t > c.y) {
                t = c.y;
              }
              if (b < c.y) {
                return b = c.y;
              }
            });
            if (l > r) {
              t = l = 0;
              b = r = MAP_SIZE_TILES - 1;
            }
            x = round(l + (r - l) / 2);
            y = round(t + (b - t) / 2);
            return this.cellAtTile(x, y);
          }
          //### Saving and loading
          // Dump the map to an array of octets in BMAP format.
          dump(options) {
            var b, bases, c, consecutiveCells, data, encodeNibbles, ensureRunSpace, ex, flushRun, flushSequence, j, k, len, len1, len2, len3, m, o, p, pills, ref, row, run, s, seq, starts, sx, y;
            options || (options = {});
            consecutiveCells = function(row2, cb) {
              var cell, count, currentType, j2, len4, num, startx, x;
              currentType = null;
              startx = null;
              count = 0;
              for (x = j2 = 0, len4 = row2.length; j2 < len4; x = ++j2) {
                cell = row2[x];
                num = cell.getNumericType();
                if (currentType === num) {
                  count++;
                  continue;
                }
                if (currentType != null) {
                  cb(currentType, count, startx);
                }
                currentType = num;
                startx = x;
                count = 1;
              }
              if (currentType != null) {
                cb(currentType, count, startx);
              }
            };
            encodeNibbles = function(nibbles) {
              var i, j2, len4, nibble, octets, val;
              octets = [];
              val = null;
              for (i = j2 = 0, len4 = nibbles.length; j2 < len4; i = ++j2) {
                nibble = nibbles[i];
                nibble = nibble & 15;
                if (i % 2 === 0) {
                  val = nibble << 4;
                } else {
                  octets.push(val + nibble);
                  val = null;
                }
              }
              if (val != null) {
                octets.push(val);
              }
              return octets;
            };
            pills = options.noPills ? [] : this.pills;
            bases = options.noBases ? [] : this.bases;
            starts = options.noStarts ? [] : this.starts;
            data = (function() {
              var j2, len4, ref2, results;
              ref2 = "BMAPBOLO";
              results = [];
              for (j2 = 0, len4 = ref2.length; j2 < len4; j2++) {
                c = ref2[j2];
                results.push(c.charCodeAt(0));
              }
              return results;
            })();
            data.push(1, pills.length, bases.length, starts.length);
            for (j = 0, len = pills.length; j < len; j++) {
              p = pills[j];
              data.push(p.x, p.y, p.owner_idx, p.armour, p.speed);
            }
            for (k = 0, len1 = bases.length; k < len1; k++) {
              b = bases[k];
              data.push(b.x, b.y, b.owner_idx, b.armour, b.shells, b.mines);
            }
            for (m = 0, len2 = starts.length; m < len2; m++) {
              s = starts[m];
              data.push(s.x, s.y, s.direction);
            }
            run = seq = sx = ex = y = null;
            flushRun = function() {
              var octets;
              if (run == null) {
                return;
              }
              flushSequence();
              octets = encodeNibbles(run);
              data.push(octets.length + 4, y, sx, ex);
              data = data.concat(octets);
              return run = null;
            };
            ensureRunSpace = function(numNibbles) {
              if (!((255 - 4) * 2 - run.length < numNibbles)) {
                return;
              }
              flushRun();
              run = [];
              return sx = ex;
            };
            flushSequence = function() {
              var localSeq;
              if (seq == null) {
                return;
              }
              localSeq = seq;
              seq = null;
              ensureRunSpace(localSeq.length + 1);
              run.push(localSeq.length - 1);
              run = run.concat(localSeq);
              return ex += localSeq.length;
            };
            ref = this.cells;
            for (o = 0, len3 = ref.length; o < len3; o++) {
              row = ref[o];
              y = row[0].y;
              run = sx = ex = seq = null;
              consecutiveCells(row, function(type, count, x) {
                var results, seqLen;
                if (type === -1) {
                  flushRun();
                  return;
                }
                if (run == null) {
                  run = [];
                  sx = ex = x;
                }
                if (count > 2) {
                  flushSequence();
                  while (count > 2) {
                    ensureRunSpace(2);
                    seqLen = min(count, 9);
                    run.push(seqLen + 6, type);
                    ex += seqLen;
                    count -= seqLen;
                  }
                }
                results = [];
                while (count > 0) {
                  if (seq == null) {
                    seq = [];
                  }
                  seq.push(type);
                  if (seq.length === 8) {
                    flushSequence();
                  }
                  results.push(count--);
                }
                return results;
              });
            }
            flushRun();
            data.push(4, 255, 255, 255);
            return data;
          }
          // Load a map from +buffer+. The buffer is treated as an array of numbers
          // representing octets. So a node.js Buffer will work.
          static load(buffer) {
            var args, basesData, c, dataLen, ex, filePos, i, j, k, len, m, magic, map, numBases, numPills, numStarts, pillsData, readBytes, ref, ref1, ref2, run, runPos, seqLen, startsData, sx, takeNibble, type, version, x, y;
            filePos = 0;
            readBytes = function(num, msg) {
              var e, sub, x2;
              sub = (function() {
                var j2, len2, ref3, results;
                try {
                  ref3 = buffer.slice(filePos, filePos + num);
                  results = [];
                  for (j2 = 0, len2 = ref3.length; j2 < len2; j2++) {
                    x2 = ref3[j2];
                    results.push(x2);
                  }
                  return results;
                } catch (error) {
                  e = error;
                  throw msg;
                }
              })();
              filePos += num;
              return sub;
            };
            magic = readBytes(8, "Not a Bolo map.");
            ref = "BMAPBOLO";
            for (i = j = 0, len = ref.length; j < len; i = ++j) {
              c = ref[i];
              if (c.charCodeAt(0) !== magic[i]) {
                throw "Not a Bolo map.";
              }
            }
            [version, numPills, numBases, numStarts] = readBytes(4, "Incomplete header");
            if (version !== 1) {
              throw `Unsupported map version: ${version}`;
            }
            map = new this();
            pillsData = (function() {
              var k2, ref12, results;
              results = [];
              for (i = k2 = 0, ref12 = numPills; 0 <= ref12 ? k2 < ref12 : k2 > ref12; i = 0 <= ref12 ? ++k2 : --k2) {
                results.push(readBytes(5, "Incomplete pillbox data"));
              }
              return results;
            })();
            basesData = (function() {
              var k2, ref12, results;
              results = [];
              for (i = k2 = 0, ref12 = numBases; 0 <= ref12 ? k2 < ref12 : k2 > ref12; i = 0 <= ref12 ? ++k2 : --k2) {
                results.push(readBytes(6, "Incomplete base data"));
              }
              return results;
            })();
            startsData = (function() {
              var k2, ref12, results;
              results = [];
              for (i = k2 = 0, ref12 = numStarts; 0 <= ref12 ? k2 < ref12 : k2 > ref12; i = 0 <= ref12 ? ++k2 : --k2) {
                results.push(readBytes(3, "Incomplete player start data"));
              }
              return results;
            })();
            while (true) {
              [dataLen, y, sx, ex] = readBytes(4, "Incomplete map data");
              dataLen -= 4;
              if (dataLen === 0 && y === 255 && sx === 255 && ex === 255) {
                break;
              }
              run = readBytes(dataLen, "Incomplete map data");
              runPos = 0;
              takeNibble = function() {
                var index, nibble;
                index = floor(runPos);
                nibble = index === runPos ? (run[index] & 240) >> 4 : run[index] & 15;
                runPos += 0.5;
                return nibble;
              };
              x = sx;
              while (x < ex) {
                seqLen = takeNibble();
                if (seqLen < 8) {
                  for (i = k = 1, ref1 = seqLen + 1; 1 <= ref1 ? k <= ref1 : k >= ref1; i = 1 <= ref1 ? ++k : --k) {
                    map.cellAtTile(x++, y).setType(takeNibble(), void 0, -1);
                  }
                } else {
                  type = takeNibble();
                  for (i = m = 1, ref2 = seqLen - 6; 1 <= ref2 ? m <= ref2 : m >= ref2; i = 1 <= ref2 ? ++m : --m) {
                    map.cellAtTile(x++, y).setType(type, void 0, -1);
                  }
                }
              }
            }
            map.pills = (function() {
              var len1, o, results;
              results = [];
              for (o = 0, len1 = pillsData.length; o < len1; o++) {
                args = pillsData[o];
                results.push(new map.PillboxClass(map, ...args));
              }
              return results;
            })();
            map.bases = (function() {
              var len1, o, results;
              results = [];
              for (o = 0, len1 = basesData.length; o < len1; o++) {
                args = basesData[o];
                results.push(new map.BaseClass(map, ...args));
              }
              return results;
            })();
            map.starts = (function() {
              var len1, o, results;
              results = [];
              for (o = 0, len1 = startsData.length; o < len1; o++) {
                args = startsData[o];
                results.push(new map.StartClass(map, ...args));
              }
              return results;
            })();
            return map;
          }
          static extended(child) {
            if (!child.load) {
              return child.load = this.load;
            }
          }
        }
        ;
        Map2.prototype.CellClass = MapCell;
        Map2.prototype.PillboxClass = Pillbox;
        Map2.prototype.BaseClass = Base;
        Map2.prototype.StartClass = Start;
        return Map2;
      }).call(exports);
      exports.TERRAIN_TYPES = TERRAIN_TYPES;
      exports.MapView = MapView;
      exports.Map = Map;
    }
  });

  // compiled/src/net.js
  var require_net = __commonJS({
    "compiled/src/net.js"(exports) {
      exports.SYNC_MESSAGE = "s".charCodeAt(0);
      exports.WELCOME_MESSAGE = "W".charCodeAt(0);
      exports.CREATE_MESSAGE = "C".charCodeAt(0);
      exports.DESTROY_MESSAGE = "D".charCodeAt(0);
      exports.MAPCHANGE_MESSAGE = "M".charCodeAt(0);
      exports.UPDATE_MESSAGE = "U".charCodeAt(0);
      exports.TINY_UPDATE_MESSAGE = "u".charCodeAt(0);
      exports.SOUNDEFFECT_MESSAGE = "S".charCodeAt(0);
      exports.START_TURNING_CCW = "L";
      exports.STOP_TURNING_CCW = "l";
      exports.START_TURNING_CW = "R";
      exports.STOP_TURNING_CW = "r";
      exports.START_ACCELERATING = "A";
      exports.STOP_ACCELERATING = "a";
      exports.START_BRAKING = "B";
      exports.STOP_BRAKING = "b";
      exports.START_SHOOTING = "S";
      exports.STOP_SHOOTING = "s";
      exports.INC_RANGE = "I";
      exports.DEC_RANGE = "D";
      exports.BUILD_ORDER = "O";
    }
  });

  // compiled/src/sounds.js
  var require_sounds = __commonJS({
    "compiled/src/sounds.js"(exports) {
      exports.BIG_EXPLOSION = 0;
      exports.BUBBLES = 1;
      exports.FARMING_TREE = 2;
      exports.HIT_TANK = 3;
      exports.MAN_BUILDING = 4;
      exports.MAN_DYING = 5;
      exports.MAN_LAY_MINE = 6;
      exports.MINE_EXPLOSION = 7;
      exports.SHOOTING = 8;
      exports.SHOT_BUILDING = 9;
      exports.SHOT_TREE = 10;
      exports.TANK_SINKING = 11;
    }
  });

  // compiled/src/helpers.js
  var require_helpers = __commonJS({
    "compiled/src/helpers.js"(exports) {
      var atan2;
      var distance;
      var extend;
      var heading;
      var sqrt;
      ({ sqrt, atan2 } = Math);
      extend = exports.extend = function(object, properties) {
        var key, val;
        for (key in properties) {
          val = properties[key];
          object[key] = val;
        }
        return object;
      };
      distance = exports.distance = function(a, b) {
        var dx, dy;
        dx = a.x - b.x;
        dy = a.y - b.y;
        return sqrt(dx * dx + dy * dy);
      };
      heading = exports.heading = function(a, b) {
        return atan2(b.y - a.y, b.x - a.x);
      };
    }
  });

  // compiled/node_modules/events/events.js
  var require_events = __commonJS({
    "compiled/node_modules/events/events.js"(exports, module) {
      "use strict";
      var R = typeof Reflect === "object" ? Reflect : null;
      var ReflectApply = R && typeof R.apply === "function" ? R.apply : function ReflectApply2(target, receiver, args) {
        return Function.prototype.apply.call(target, receiver, args);
      };
      var ReflectOwnKeys;
      if (R && typeof R.ownKeys === "function") {
        ReflectOwnKeys = R.ownKeys;
      } else if (Object.getOwnPropertySymbols) {
        ReflectOwnKeys = function ReflectOwnKeys2(target) {
          return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
        };
      } else {
        ReflectOwnKeys = function ReflectOwnKeys2(target) {
          return Object.getOwnPropertyNames(target);
        };
      }
      function ProcessEmitWarning(warning) {
        if (console && console.warn) console.warn(warning);
      }
      var NumberIsNaN = Number.isNaN || function NumberIsNaN2(value) {
        return value !== value;
      };
      function EventEmitter() {
        EventEmitter.init.call(this);
      }
      module.exports = EventEmitter;
      module.exports.once = once;
      EventEmitter.EventEmitter = EventEmitter;
      EventEmitter.prototype._events = void 0;
      EventEmitter.prototype._eventsCount = 0;
      EventEmitter.prototype._maxListeners = void 0;
      var defaultMaxListeners = 10;
      function checkListener(listener) {
        if (typeof listener !== "function") {
          throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
        }
      }
      Object.defineProperty(EventEmitter, "defaultMaxListeners", {
        enumerable: true,
        get: function() {
          return defaultMaxListeners;
        },
        set: function(arg) {
          if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) {
            throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + ".");
          }
          defaultMaxListeners = arg;
        }
      });
      EventEmitter.init = function() {
        if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        }
        this._maxListeners = this._maxListeners || void 0;
      };
      EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
        if (typeof n !== "number" || n < 0 || NumberIsNaN(n)) {
          throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
        }
        this._maxListeners = n;
        return this;
      };
      function _getMaxListeners(that) {
        if (that._maxListeners === void 0)
          return EventEmitter.defaultMaxListeners;
        return that._maxListeners;
      }
      EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
        return _getMaxListeners(this);
      };
      EventEmitter.prototype.emit = function emit(type) {
        var args = [];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        var doError = type === "error";
        var events = this._events;
        if (events !== void 0)
          doError = doError && events.error === void 0;
        else if (!doError)
          return false;
        if (doError) {
          var er;
          if (args.length > 0)
            er = args[0];
          if (er instanceof Error) {
            throw er;
          }
          var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
          err.context = er;
          throw err;
        }
        var handler = events[type];
        if (handler === void 0)
          return false;
        if (typeof handler === "function") {
          ReflectApply(handler, this, args);
        } else {
          var len = handler.length;
          var listeners = arrayClone(handler, len);
          for (var i = 0; i < len; ++i)
            ReflectApply(listeners[i], this, args);
        }
        return true;
      };
      function _addListener(target, type, listener, prepend) {
        var m;
        var events;
        var existing;
        checkListener(listener);
        events = target._events;
        if (events === void 0) {
          events = target._events = /* @__PURE__ */ Object.create(null);
          target._eventsCount = 0;
        } else {
          if (events.newListener !== void 0) {
            target.emit(
              "newListener",
              type,
              listener.listener ? listener.listener : listener
            );
            events = target._events;
          }
          existing = events[type];
        }
        if (existing === void 0) {
          existing = events[type] = listener;
          ++target._eventsCount;
        } else {
          if (typeof existing === "function") {
            existing = events[type] = prepend ? [listener, existing] : [existing, listener];
          } else if (prepend) {
            existing.unshift(listener);
          } else {
            existing.push(listener);
          }
          m = _getMaxListeners(target);
          if (m > 0 && existing.length > m && !existing.warned) {
            existing.warned = true;
            var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
            w.name = "MaxListenersExceededWarning";
            w.emitter = target;
            w.type = type;
            w.count = existing.length;
            ProcessEmitWarning(w);
          }
        }
        return target;
      }
      EventEmitter.prototype.addListener = function addListener(type, listener) {
        return _addListener(this, type, listener, false);
      };
      EventEmitter.prototype.on = EventEmitter.prototype.addListener;
      EventEmitter.prototype.prependListener = function prependListener(type, listener) {
        return _addListener(this, type, listener, true);
      };
      function onceWrapper() {
        if (!this.fired) {
          this.target.removeListener(this.type, this.wrapFn);
          this.fired = true;
          if (arguments.length === 0)
            return this.listener.call(this.target);
          return this.listener.apply(this.target, arguments);
        }
      }
      function _onceWrap(target, type, listener) {
        var state = { fired: false, wrapFn: void 0, target, type, listener };
        var wrapped = onceWrapper.bind(state);
        wrapped.listener = listener;
        state.wrapFn = wrapped;
        return wrapped;
      }
      EventEmitter.prototype.once = function once2(type, listener) {
        checkListener(listener);
        this.on(type, _onceWrap(this, type, listener));
        return this;
      };
      EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
        checkListener(listener);
        this.prependListener(type, _onceWrap(this, type, listener));
        return this;
      };
      EventEmitter.prototype.removeListener = function removeListener(type, listener) {
        var list, events, position, i, originalListener;
        checkListener(listener);
        events = this._events;
        if (events === void 0)
          return this;
        list = events[type];
        if (list === void 0)
          return this;
        if (list === listener || list.listener === listener) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else {
            delete events[type];
            if (events.removeListener)
              this.emit("removeListener", type, list.listener || listener);
          }
        } else if (typeof list !== "function") {
          position = -1;
          for (i = list.length - 1; i >= 0; i--) {
            if (list[i] === listener || list[i].listener === listener) {
              originalListener = list[i].listener;
              position = i;
              break;
            }
          }
          if (position < 0)
            return this;
          if (position === 0)
            list.shift();
          else {
            spliceOne(list, position);
          }
          if (list.length === 1)
            events[type] = list[0];
          if (events.removeListener !== void 0)
            this.emit("removeListener", type, originalListener || listener);
        }
        return this;
      };
      EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
      EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
        var listeners, events, i;
        events = this._events;
        if (events === void 0)
          return this;
        if (events.removeListener === void 0) {
          if (arguments.length === 0) {
            this._events = /* @__PURE__ */ Object.create(null);
            this._eventsCount = 0;
          } else if (events[type] !== void 0) {
            if (--this._eventsCount === 0)
              this._events = /* @__PURE__ */ Object.create(null);
            else
              delete events[type];
          }
          return this;
        }
        if (arguments.length === 0) {
          var keys = Object.keys(events);
          var key;
          for (i = 0; i < keys.length; ++i) {
            key = keys[i];
            if (key === "removeListener") continue;
            this.removeAllListeners(key);
          }
          this.removeAllListeners("removeListener");
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
          return this;
        }
        listeners = events[type];
        if (typeof listeners === "function") {
          this.removeListener(type, listeners);
        } else if (listeners !== void 0) {
          for (i = listeners.length - 1; i >= 0; i--) {
            this.removeListener(type, listeners[i]);
          }
        }
        return this;
      };
      function _listeners(target, type, unwrap) {
        var events = target._events;
        if (events === void 0)
          return [];
        var evlistener = events[type];
        if (evlistener === void 0)
          return [];
        if (typeof evlistener === "function")
          return unwrap ? [evlistener.listener || evlistener] : [evlistener];
        return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
      }
      EventEmitter.prototype.listeners = function listeners(type) {
        return _listeners(this, type, true);
      };
      EventEmitter.prototype.rawListeners = function rawListeners(type) {
        return _listeners(this, type, false);
      };
      EventEmitter.listenerCount = function(emitter, type) {
        if (typeof emitter.listenerCount === "function") {
          return emitter.listenerCount(type);
        } else {
          return listenerCount.call(emitter, type);
        }
      };
      EventEmitter.prototype.listenerCount = listenerCount;
      function listenerCount(type) {
        var events = this._events;
        if (events !== void 0) {
          var evlistener = events[type];
          if (typeof evlistener === "function") {
            return 1;
          } else if (evlistener !== void 0) {
            return evlistener.length;
          }
        }
        return 0;
      }
      EventEmitter.prototype.eventNames = function eventNames() {
        return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
      };
      function arrayClone(arr, n) {
        var copy = new Array(n);
        for (var i = 0; i < n; ++i)
          copy[i] = arr[i];
        return copy;
      }
      function spliceOne(list, index) {
        for (; index + 1 < list.length; index++)
          list[index] = list[index + 1];
        list.pop();
      }
      function unwrapListeners(arr) {
        var ret = new Array(arr.length);
        for (var i = 0; i < ret.length; ++i) {
          ret[i] = arr[i].listener || arr[i];
        }
        return ret;
      }
      function once(emitter, name) {
        return new Promise(function(resolve, reject) {
          function errorListener(err) {
            emitter.removeListener(name, resolver);
            reject(err);
          }
          function resolver() {
            if (typeof emitter.removeListener === "function") {
              emitter.removeListener("error", errorListener);
            }
            resolve([].slice.call(arguments));
          }
          ;
          eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
          if (name !== "error") {
            addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
          }
        });
      }
      function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
        if (typeof emitter.on === "function") {
          eventTargetAgnosticAddListener(emitter, "error", handler, flags);
        }
      }
      function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
        if (typeof emitter.on === "function") {
          if (flags.once) {
            emitter.once(name, listener);
          } else {
            emitter.on(name, listener);
          }
        } else if (typeof emitter.addEventListener === "function") {
          emitter.addEventListener(name, function wrapListener(arg) {
            if (flags.once) {
              emitter.removeEventListener(name, wrapListener);
            }
            listener(arg);
          });
        } else {
          throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
        }
      }
    }
  });

  // compiled/node_modules/villain/world/object.js
  var require_object = __commonJS({
    "compiled/node_modules/villain/world/object.js"(exports, module) {
      var EventEmitter;
      var WorldObject;
      ({ EventEmitter } = require_events());
      WorldObject = (function() {
        class WorldObject2 extends EventEmitter {
          // Instantiating a `WorldObject` is done using `world.spawn(MyObject, params...);`. This wraps the
          // call to the actual constructor, and the world can thus keep track of the object.
          // Any `spawn` parameters are passed to the `spawn` method of this object. The constructor itself
          // is usually bare-bones, only receiving and setting the `world` attribute, and adding listeners.
          constructor(world) {
            super();
            this.world = world;
          }
          //### Abstract methods
          // These methods are called at key moments during the object's life span. They are called before
          // the related events are emitted. All of these are optional to implement.
          spawn() {
          }
          update() {
          }
          destroy() {
          }
          //### Events
          // You can install listeners for any of the following events in the constructor, or through
          // references from within other objects:
          // * `spawn`
          // * `update`
          // * `destroy`
          // These are called after the related methods defined above.
          // There is also a special event:
          // * `finalize`
          // The finalize event is called when you can be completely sure the object is gone. This is more
          // definitive than `destroy` for example, because networking may still revive an object after
          // such an event.
          //### Helpers
          // This helper is used to track references to other objects. The idea is to keep track of
          // listeners installed on the other object, which directly or indirectly (through a closure) hold
          // a back-reference. If we go away, or the reference is cleared, these listeners will be cleaned
          // up as well.
          // We can't really create proxies in JavaScript (yet), so this tries to make things as painless
          // as possible. The `attribute` of this object is set to a thin wrapper. You may dereference
          // simply by doing: `@other.$.something`. However, to add an event listener on the other object
          // you do *not* dereference, but instead do: `@other.on 'someEvent', someHandler`.
          ref(attribute, other) {
            var r, ref, ref1;
            if (((ref = this[attribute]) != null ? ref.$ : void 0) === other) {
              return this[attribute];
            }
            if ((ref1 = this[attribute]) != null) {
              ref1.clear();
            }
            if (!other) {
              return;
            }
            this[attribute] = r = {
              $: other,
              owner: this,
              attribute
            };
            r.events = {};
            r.on = function(event, listener) {
              var base;
              other.on(event, listener);
              ((base = r.events)[event] || (base[event] = [])).push(listener);
              return r;
            };
            r.clear = function() {
              var event, i, len, listener, listeners, ref2;
              ref2 = r.events;
              for (event in ref2) {
                listeners = ref2[event];
                for (i = 0, len = listeners.length; i < len; i++) {
                  listener = listeners[i];
                  other.removeListener(event, listener);
                }
              }
              r.owner.removeListener("finalize", r.clear);
              return r.owner[r.attribute] = null;
            };
            r.on("finalize", r.clear);
            r.owner.on("finalize", r.clear);
            return r;
          }
        }
        ;
        WorldObject2.prototype.world = null;
        WorldObject2.prototype.idx = null;
        WorldObject2.prototype.updatePriority = 0;
        return WorldObject2;
      }).call(exports);
      module.exports = WorldObject;
    }
  });

  // compiled/node_modules/villain/world/net/object.js
  var require_object2 = __commonJS({
    "compiled/node_modules/villain/world/net/object.js"(exports, module) {
      var NetWorldObject;
      var WorldObject;
      WorldObject = require_object();
      NetWorldObject = (function() {
        class NetWorldObject2 extends WorldObject {
          //### Abstract methods
          // `serialization` is called to serialize and deserialize an object's state. The parameter `p`
          // is a function which should be repeatedly called for each property of the object. It takes as
          // its first parameter a format specifier for `struct`, and as its second parameter an attribute
          // name.
          // A special format specifier `O` may be used to (de-)serialize a reference to another object.
          // There are also two options, `tx` and `rx`, that can be specified when calling `p`. Each of
          // these is a function that transforms the attribute value before sending and receiving
          // respectively.
          // The `isCreate` parameter is true if called in response to a create message. This can be used to
          // synchronize parameters that are only ever set once at construction.
          // If the function is called to serialize, then attributes are collected to form a packet.
          // If the function is called to deserialize, then attributes are filled with new values.
          serialization(isCreate, p) {
          }
          // `netSpawn` is called after an object was instantiated and deserialized from the network.
          netSpawn() {
          }
          // The `anySpawn` method is a convenience called after both `spawn` and `netSpawn`.
          anySpawn() {
          }
        }
        ;
        NetWorldObject2.prototype.charId = null;
        return NetWorldObject2;
      }).call(exports);
      module.exports = NetWorldObject;
    }
  });

  // compiled/src/object.js
  var require_object3 = __commonJS({
    "compiled/src/object.js"(exports, module) {
      var BoloObject;
      var NetWorldObject;
      NetWorldObject = require_object2();
      BoloObject = (function() {
        class BoloObject2 extends NetWorldObject {
          // Emit a sound effect from this object's location.
          soundEffect(sfx) {
            return this.world.soundEffect(sfx, this.x, this.y, this);
          }
          //### Abstract methods
          // Return the (x,y) index in the tilemap (base or styled, selected above) that the object should
          // be drawn with. May be a no-op if the object is never actually drawn.
          getTile() {
          }
        }
        ;
        BoloObject2.prototype.styled = null;
        BoloObject2.prototype.team = null;
        BoloObject2.prototype.x = null;
        BoloObject2.prototype.y = null;
        return BoloObject2;
      }).call(exports);
      module.exports = BoloObject;
    }
  });

  // compiled/src/objects/explosion.js
  var require_explosion = __commonJS({
    "compiled/src/objects/explosion.js"(exports, module) {
      var BoloObject;
      var Explosion;
      var floor;
      ({ floor } = Math);
      BoloObject = require_object3();
      Explosion = (function() {
        class Explosion2 extends BoloObject {
          serialization(isCreate, p) {
            if (isCreate) {
              p("H", "x");
              p("H", "y");
            }
            return p("B", "lifespan");
          }
          getTile() {
            switch (floor(this.lifespan / 3)) {
              case 7:
                return [20, 3];
              case 6:
                return [21, 3];
              case 5:
                return [20, 4];
              case 4:
                return [21, 4];
              case 3:
                return [20, 5];
              case 2:
                return [21, 5];
              case 1:
                return [18, 4];
              default:
                return [19, 4];
            }
          }
          //### World updates
          spawn(x, y) {
            this.x = x;
            this.y = y;
            return this.lifespan = 23;
          }
          update() {
            if (this.lifespan-- === 0) {
              return this.world.destroy(this);
            }
          }
        }
        ;
        Explosion2.prototype.styled = false;
        return Explosion2;
      }).call(exports);
      module.exports = Explosion;
    }
  });

  // compiled/src/objects/mine_explosion.js
  var require_mine_explosion = __commonJS({
    "compiled/src/objects/mine_explosion.js"(exports, module) {
      var BoloObject;
      var Explosion;
      var MineExplosion;
      var TILE_SIZE_WORLD;
      var distance;
      var sounds;
      ({ TILE_SIZE_WORLD } = require_constants());
      ({ distance } = require_helpers());
      BoloObject = require_object3();
      sounds = require_sounds();
      Explosion = require_explosion();
      MineExplosion = (function() {
        class MineExplosion2 extends BoloObject {
          serialization(isCreate, p) {
            if (isCreate) {
              p("H", "x");
              p("H", "y");
            }
            return p("B", "lifespan");
          }
          //### World updates
          spawn(cell) {
            [this.x, this.y] = cell.getWorldCoordinates();
            return this.lifespan = 10;
          }
          anySpawn() {
            return this.cell = this.world.map.cellAtWorld(this.x, this.y);
          }
          update() {
            if (this.lifespan-- === 0) {
              if (this.cell.mine) {
                this.asplode();
              }
              return this.world.destroy(this);
            }
          }
          asplode() {
            var builder, i, len, ref, ref1, tank;
            this.cell.setType(null, false, 0);
            this.cell.takeExplosionHit();
            ref = this.world.tanks;
            for (i = 0, len = ref.length; i < len; i++) {
              tank = ref[i];
              if (tank.armour !== 255 && distance(this, tank) < 384) {
                tank.takeMineHit();
              }
              builder = tank.builder.$;
              if ((ref1 = builder.order) !== builder.states.inTank && ref1 !== builder.states.parachuting) {
                if (distance(this, builder) < TILE_SIZE_WORLD / 2) {
                  builder.kill();
                }
              }
            }
            this.world.spawn(Explosion, this.x, this.y);
            this.soundEffect(sounds.MINE_EXPLOSION);
            return this.spread();
          }
          spread() {
            var n;
            n = this.cell.neigh(1, 0);
            if (!n.isEdgeCell()) {
              this.world.spawn(MineExplosion2, n);
            }
            n = this.cell.neigh(0, 1);
            if (!n.isEdgeCell()) {
              this.world.spawn(MineExplosion2, n);
            }
            n = this.cell.neigh(-1, 0);
            if (!n.isEdgeCell()) {
              this.world.spawn(MineExplosion2, n);
            }
            n = this.cell.neigh(0, -1);
            if (!n.isEdgeCell()) {
              return this.world.spawn(MineExplosion2, n);
            }
          }
        }
        ;
        MineExplosion2.prototype.styled = null;
        return MineExplosion2;
      }).call(exports);
      module.exports = MineExplosion;
    }
  });

  // compiled/src/objects/shell.js
  var require_shell = __commonJS({
    "compiled/src/objects/shell.js"(exports, module) {
      var BoloObject;
      var Destructable;
      var Explosion;
      var MineExplosion;
      var PI;
      var Shell;
      var TILE_SIZE_WORLD;
      var cos;
      var distance;
      var floor;
      var round;
      var sin;
      var boundMethodCheck = function(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new Error("Bound instance method accessed before binding");
        }
      };
      ({ round, floor, cos, sin, PI } = Math);
      ({ distance } = require_helpers());
      BoloObject = require_object3();
      ({ TILE_SIZE_WORLD } = require_constants());
      Explosion = require_explosion();
      MineExplosion = require_mine_explosion();
      Destructable = class Destructable {
        takeShellHit(shell) {
        }
      };
      Shell = (function() {
        class Shell2 extends BoloObject {
          constructor(world) {
            super(world);
            this.spawn = this.spawn.bind(this);
            this.world = world;
            this.on("netSync", () => {
              return this.updateCell();
            });
          }
          serialization(isCreate, p) {
            if (isCreate) {
              p("B", "direction");
              p("O", "owner");
              p("O", "attribution");
              p("f", "onWater");
            }
            p("H", "x");
            p("H", "y");
            return p("B", "lifespan");
          }
          // Helper, called in several places that change shell position.
          updateCell() {
            return this.cell = this.world.map.cellAtWorld(this.x, this.y);
          }
          // Get the 1/16th direction step.
          getDirection16th() {
            return round((this.direction - 1) / 16) % 16;
          }
          // Get the tilemap index to draw. This is the index in base.png.
          getTile() {
            var tx;
            tx = this.getDirection16th();
            return [tx, 4];
          }
          spawn(owner, options) {
            var ref;
            boundMethodCheck(this, Shell2);
            options || (options = {});
            this.ref("owner", owner);
            if (this.owner.$.hasOwnProperty("owner_idx")) {
              this.ref("attribution", (ref = this.owner.$.owner) != null ? ref.$ : void 0);
            } else {
              this.ref("attribution", this.owner.$);
            }
            this.direction = options.direction || this.owner.$.direction;
            this.lifespan = (options.range || 7) * TILE_SIZE_WORLD / 32 - 2;
            this.onWater = options.onWater || false;
            this.x = this.owner.$.x;
            this.y = this.owner.$.y;
            return this.move();
          }
          update() {
            var collision, mode, sfx, victim, x, y;
            this.move();
            collision = this.collide();
            if (collision) {
              [mode, victim] = collision;
              sfx = victim.takeShellHit(this);
              if (mode === "cell") {
                [x, y] = this.cell.getWorldCoordinates();
                this.world.soundEffect(sfx, x, y);
              } else {
                ({ x, y } = this);
                victim.soundEffect(sfx);
              }
              return this.asplode(x, y, mode);
            } else if (this.lifespan-- === 0) {
              return this.asplode(this.x, this.y, "eol");
            }
          }
          move() {
            this.radians || (this.radians = (256 - this.direction) * 2 * PI / 256);
            this.x += round(cos(this.radians) * 32);
            this.y += round(sin(this.radians) * 32);
            return this.updateCell();
          }
          collide() {
            var base, i, len, pill, ref, ref1, ref2, ref3, ref4, ref5, tank, terrainCollision, x, y;
            if ((pill = this.cell.pill) && pill.armour > 0 && pill !== ((ref = this.owner) != null ? ref.$ : void 0)) {
              [x, y] = this.cell.getWorldCoordinates();
              if (distance(this, { x, y }) <= 127) {
                return ["cell", pill];
              }
            }
            ref1 = this.world.tanks;
            for (i = 0, len = ref1.length; i < len; i++) {
              tank = ref1[i];
              if (tank !== ((ref2 = this.owner) != null ? ref2.$ : void 0) && tank.armour !== 255) {
                if (distance(this, tank) <= 127) {
                  return ["tank", tank];
                }
              }
            }
            if (((ref3 = this.attribution) != null ? ref3.$ : void 0) === ((ref4 = this.owner) != null ? ref4.$ : void 0) && (base = this.cell.base) && base.armour > 4) {
              if (this.onWater || (base != null ? base.owner : void 0) != null && !base.owner.$.isAlly((ref5 = this.attribution) != null ? ref5.$ : void 0)) {
                return ["cell", base];
              }
            }
            terrainCollision = this.onWater ? !this.cell.isType("^", " ", "%") : this.cell.isType("|", "}", "#", "b");
            if (terrainCollision) {
              return ["cell", this.cell];
            }
          }
          asplode(x, y, mode) {
            var builder, i, len, ref, ref1, tank;
            ref = this.world.tanks;
            for (i = 0, len = ref.length; i < len; i++) {
              tank = ref[i];
              if (builder = tank.builder.$) {
                if ((ref1 = builder.order) !== builder.states.inTank && ref1 !== builder.states.parachuting) {
                  if (mode === "cell") {
                    if (builder.cell === this.cell) {
                      builder.kill();
                    }
                  } else {
                    if (distance(this, builder) < TILE_SIZE_WORLD / 2) {
                      builder.kill();
                    }
                  }
                }
              }
            }
            this.world.spawn(Explosion, x, y);
            this.world.spawn(MineExplosion, this.cell);
            return this.world.destroy(this);
          }
        }
        ;
        Shell2.prototype.updatePriority = 20;
        Shell2.prototype.styled = false;
        return Shell2;
      }).call(exports);
      module.exports = Shell;
    }
  });

  // compiled/src/objects/world_pillbox.js
  var require_world_pillbox = __commonJS({
    "compiled/src/objects/world_pillbox.js"(exports, module) {
      var BoloObject;
      var PI;
      var Shell;
      var TILE_SIZE_WORLD;
      var WorldPillbox;
      var ceil;
      var cos;
      var distance;
      var heading;
      var max;
      var min;
      var round;
      var sin;
      var sounds;
      ({ min, max, round, ceil, PI, cos, sin } = Math);
      ({ TILE_SIZE_WORLD } = require_constants());
      ({ distance, heading } = require_helpers());
      BoloObject = require_object3();
      sounds = require_sounds();
      Shell = require_shell();
      WorldPillbox = class WorldPillbox extends BoloObject {
        // This is a MapObject; it is constructed differently on the server.
        constructor(world_or_map, x, y, owner_idx, armour, speed) {
          super();
          this.owner_idx = owner_idx;
          this.armour = armour;
          this.speed = speed;
          if (arguments.length === 1) {
            this.world = world_or_map;
          } else {
            this.x = (x + 0.5) * TILE_SIZE_WORLD;
            this.y = (y + 0.5) * TILE_SIZE_WORLD;
          }
          this.on("netUpdate", (changes) => {
            var ref;
            if (changes.hasOwnProperty("x") || changes.hasOwnProperty("y")) {
              this.updateCell();
            }
            if (changes.hasOwnProperty("inTank") || changes.hasOwnProperty("carried")) {
              this.updateCell();
            }
            if (changes.hasOwnProperty("owner")) {
              this.updateOwner();
            }
            if (changes.hasOwnProperty("armour")) {
              return (ref = this.cell) != null ? ref.retile() : void 0;
            }
          });
        }
        // Helper that updates the cell reference, and ensures a back-reference as well.
        updateCell() {
          if (this.cell != null) {
            delete this.cell.pill;
            this.cell.retile();
          }
          if (this.inTank || this.carried) {
            return this.cell = null;
          } else {
            this.cell = this.world.map.cellAtWorld(this.x, this.y);
            this.cell.pill = this;
            return this.cell.retile();
          }
        }
        // Helper for common stuff to do when the owner changes.
        updateOwner() {
          var ref;
          if (this.owner) {
            this.owner_idx = this.owner.$.tank_idx;
            this.team = this.owner.$.team;
          } else {
            this.owner_idx = this.team = 255;
          }
          return (ref = this.cell) != null ? ref.retile() : void 0;
        }
        // The state information to synchronize.
        serialization(isCreate, p) {
          p("O", "owner");
          p("f", "inTank");
          p("f", "carried");
          p("f", "haveTarget");
          if (!(this.inTank || this.carried)) {
            p("H", "x");
            p("H", "y");
          } else {
            this.x = this.y = null;
          }
          p("B", "armour");
          p("B", "speed");
          p("B", "coolDown");
          return p("B", "reload");
        }
        // Called when dropped by a tank, or placed by a builder.
        placeAt(cell) {
          this.inTank = this.carried = false;
          [this.x, this.y] = cell.getWorldCoordinates();
          this.updateCell();
          return this.reset();
        }
        //### World updates
        spawn() {
          return this.reset();
        }
        reset() {
          this.coolDown = 32;
          return this.reload = 0;
        }
        anySpawn() {
          return this.updateCell();
        }
        update() {
          var d, direction, i, j, len, len1, rad, ref, ref1, ref2, tank, target, targetDistance, x, y;
          if (this.inTank || this.carried) {
            return;
          }
          if (this.armour === 0) {
            this.haveTarget = false;
            ref = this.world.tanks;
            for (i = 0, len = ref.length; i < len; i++) {
              tank = ref[i];
              if (tank.armour !== 255) {
                if (tank.cell === this.cell) {
                  this.inTank = true;
                  this.x = this.y = null;
                  this.updateCell();
                  this.ref("owner", tank);
                  this.updateOwner();
                  break;
                }
              }
            }
            return;
          }
          this.reload = min(this.speed, this.reload + 1);
          if (--this.coolDown === 0) {
            this.coolDown = 32;
            this.speed = min(100, this.speed + 1);
          }
          if (!(this.reload >= this.speed)) {
            return;
          }
          target = null;
          targetDistance = Infinity;
          ref1 = this.world.tanks;
          for (j = 0, len1 = ref1.length; j < len1; j++) {
            tank = ref1[j];
            if (!(tank.armour !== 255 && !((ref2 = this.owner) != null ? ref2.$.isAlly(tank) : void 0))) {
              continue;
            }
            d = distance(this, tank);
            if (d <= 2048 && d < targetDistance) {
              target = tank;
              targetDistance = d;
            }
          }
          if (!target) {
            return this.haveTarget = false;
          }
          if (this.haveTarget) {
            rad = (256 - target.getDirection16th() * 16) * 2 * PI / 256;
            x = target.x + targetDistance / 32 * round(cos(rad) * ceil(target.speed));
            y = target.y + targetDistance / 32 * round(sin(rad) * ceil(target.speed));
            direction = 256 - heading(this, { x, y }) * 256 / (2 * PI);
            this.world.spawn(Shell, this, { direction });
            this.soundEffect(sounds.SHOOTING);
          }
          this.haveTarget = true;
          return this.reload = 0;
        }
        aggravate() {
          this.coolDown = 32;
          return this.speed = max(6, round(this.speed / 2));
        }
        takeShellHit(shell) {
          this.aggravate();
          this.armour = max(0, this.armour - 1);
          this.cell.retile();
          return sounds.SHOT_BUILDING;
        }
        takeExplosionHit() {
          this.armour = max(0, this.armour - 5);
          return this.cell.retile();
        }
        repair(trees) {
          var used;
          used = min(trees, ceil((15 - this.armour) / 4));
          this.armour = min(15, this.armour + used * 4);
          this.cell.retile();
          return used;
        }
      };
      module.exports = WorldPillbox;
    }
  });

  // compiled/src/objects/world_base.js
  var require_world_base = __commonJS({
    "compiled/src/objects/world_base.js"(exports, module) {
      var BoloObject;
      var TILE_SIZE_WORLD;
      var WorldBase;
      var distance;
      var max;
      var min;
      var sounds;
      ({ min, max } = Math);
      ({ TILE_SIZE_WORLD } = require_constants());
      ({ distance } = require_helpers());
      BoloObject = require_object3();
      sounds = require_sounds();
      WorldBase = class WorldBase extends BoloObject {
        // This is a MapObject; it is constructed differently on the server.
        constructor(world_or_map, x, y, owner_idx, armour, shells, mines) {
          super();
          this.owner_idx = owner_idx;
          this.armour = armour;
          this.shells = shells;
          this.mines = mines;
          if (arguments.length === 1) {
            this.world = world_or_map;
          } else {
            this.x = (x + 0.5) * TILE_SIZE_WORLD;
            this.y = (y + 0.5) * TILE_SIZE_WORLD;
            world_or_map.cellAtTile(x, y).setType("=", false, -1);
          }
          this.on("netUpdate", (changes) => {
            if (changes.hasOwnProperty("owner")) {
              return this.updateOwner();
            }
          });
        }
        // The state information to synchronize.
        serialization(isCreate, p) {
          if (isCreate) {
            p("H", "x");
            p("H", "y");
          }
          p("O", "owner");
          p("O", "refueling");
          if (this.refueling) {
            p("B", "refuelCounter");
          }
          p("B", "armour");
          p("B", "shells");
          return p("B", "mines");
        }
        // Helper for common stuff to do when the owner changes.
        updateOwner() {
          if (this.owner) {
            this.owner_idx = this.owner.$.tank_idx;
            this.team = this.owner.$.team;
          } else {
            this.owner_idx = this.team = 255;
          }
          return this.cell.retile();
        }
        //### World updates
        anySpawn() {
          this.cell = this.world.map.cellAtWorld(this.x, this.y);
          return this.cell.base = this;
        }
        update() {
          var amount;
          if (this.refueling && (this.refueling.$.cell !== this.cell || this.refueling.$.armour === 255)) {
            this.ref("refueling", null);
          }
          if (!this.refueling) {
            return this.findSubject();
          }
          if (--this.refuelCounter !== 0) {
            return;
          }
          if (this.armour > 0 && this.refueling.$.armour < 40) {
            amount = min(5, this.armour, 40 - this.refueling.$.armour);
            this.refueling.$.armour += amount;
            this.armour -= amount;
            return this.refuelCounter = 46;
          } else if (this.shells > 0 && this.refueling.$.shells < 40) {
            this.refueling.$.shells += 1;
            this.shells -= 1;
            return this.refuelCounter = 7;
          } else if (this.mines > 0 && this.refueling.$.mines < 40) {
            this.refueling.$.mines += 1;
            this.mines -= 1;
            return this.refuelCounter = 7;
          } else {
            return this.refuelCounter = 1;
          }
        }
        // Look for someone to refuel, and check if he's claiming us too. Be careful to prevent rapid
        // reclaiming if two tanks are on the same tile.
        findSubject() {
          var canClaim, i, j, len, len1, other, ref, tank, tanks;
          tanks = (function() {
            var i2, len2, ref2, results;
            ref2 = this.world.tanks;
            results = [];
            for (i2 = 0, len2 = ref2.length; i2 < len2; i2++) {
              tank = ref2[i2];
              if (tank.armour !== 255 && tank.cell === this.cell) {
                results.push(tank);
              }
            }
            return results;
          }).call(this);
          for (i = 0, len = tanks.length; i < len; i++) {
            tank = tanks[i];
            if ((ref = this.owner) != null ? ref.$.isAlly(tank) : void 0) {
              this.ref("refueling", tank);
              this.refuelCounter = 46;
              break;
            } else {
              canClaim = true;
              for (j = 0, len1 = tanks.length; j < len1; j++) {
                other = tanks[j];
                if (other !== tank) {
                  if (!tank.isAlly(other)) {
                    canClaim = false;
                  }
                }
              }
              if (canClaim) {
                this.ref("owner", tank);
                this.updateOwner();
                this.owner.on("destroy", () => {
                  this.ref("owner", null);
                  return this.updateOwner();
                });
                this.ref("refueling", tank);
                this.refuelCounter = 46;
                break;
              }
            }
          }
        }
        takeShellHit(shell) {
          var i, len, pill, ref, ref1;
          if (this.owner) {
            ref = this.world.map.pills;
            for (i = 0, len = ref.length; i < len; i++) {
              pill = ref[i];
              if (!(pill.inTank || pill.carried) && pill.armour > 0) {
                if (((ref1 = pill.owner) != null ? ref1.$.isAlly(this.owner.$) : void 0) && distance(this, pill) <= 2304) {
                  pill.aggravate();
                }
              }
            }
          }
          this.armour = max(0, this.armour - 5);
          return sounds.SHOT_BUILDING;
        }
      };
      module.exports = WorldBase;
    }
  });

  // compiled/src/objects/flood_fill.js
  var require_flood_fill = __commonJS({
    "compiled/src/objects/flood_fill.js"(exports, module) {
      var BoloObject;
      var FloodFill;
      BoloObject = require_object3();
      FloodFill = (function() {
        class FloodFill2 extends BoloObject {
          serialization(isCreate, p) {
            if (isCreate) {
              p("H", "x");
              p("H", "y");
            }
            return p("B", "lifespan");
          }
          //### World updates
          spawn(cell) {
            [this.x, this.y] = cell.getWorldCoordinates();
            return this.lifespan = 16;
          }
          anySpawn() {
            this.cell = this.world.map.cellAtWorld(this.x, this.y);
            return this.neighbours = [this.cell.neigh(1, 0), this.cell.neigh(0, 1), this.cell.neigh(-1, 0), this.cell.neigh(0, -1)];
          }
          update() {
            if (this.lifespan-- === 0) {
              this.flood();
              return this.world.destroy(this);
            }
          }
          canGetWet() {
            var i, len, n, ref, result;
            result = false;
            ref = this.neighbours;
            for (i = 0, len = ref.length; i < len; i++) {
              n = ref[i];
              if (!(n.base || n.pill) && n.isType(" ", "^", "b")) {
                result = true;
                break;
              }
            }
            return result;
          }
          flood() {
            if (this.canGetWet()) {
              this.cell.setType(" ", false);
              return this.spread();
            }
          }
          spread() {
            var i, len, n, ref;
            ref = this.neighbours;
            for (i = 0, len = ref.length; i < len; i++) {
              n = ref[i];
              if (!(n.base || n.pill) && n.isType("%")) {
                this.world.spawn(FloodFill2, n);
              }
            }
          }
        }
        ;
        FloodFill2.prototype.styled = null;
        return FloodFill2;
      }).call(exports);
      module.exports = FloodFill;
    }
  });

  // compiled/src/world_map.js
  var require_world_map = __commonJS({
    "compiled/src/world_map.js"(exports, module) {
      var FloodFill;
      var Map;
      var TERRAIN_TYPES;
      var TERRAIN_TYPE_ATTRIBUTES;
      var TILE_SIZE_PIXELS;
      var TILE_SIZE_WORLD;
      var WorldBase;
      var WorldMap;
      var WorldMapCell;
      var WorldPillbox;
      var extendTerrainMap;
      var floor;
      var net;
      var random;
      var round;
      var sounds;
      ({ round, random, floor } = Math);
      ({ TILE_SIZE_WORLD, TILE_SIZE_PIXELS } = require_constants());
      ({ Map, TERRAIN_TYPES } = require_map());
      net = require_net();
      sounds = require_sounds();
      WorldPillbox = require_world_pillbox();
      WorldBase = require_world_base();
      FloodFill = require_flood_fill();
      TERRAIN_TYPE_ATTRIBUTES = {
        "|": {
          tankSpeed: 0,
          tankTurn: 0,
          manSpeed: 0
        },
        " ": {
          tankSpeed: 3,
          tankTurn: 0.25,
          manSpeed: 0
        },
        "~": {
          tankSpeed: 3,
          tankTurn: 0.25,
          manSpeed: 4
        },
        "%": {
          tankSpeed: 3,
          tankTurn: 0.25,
          manSpeed: 4
        },
        "=": {
          tankSpeed: 16,
          tankTurn: 1,
          manSpeed: 16
        },
        "#": {
          tankSpeed: 6,
          tankTurn: 0.5,
          manSpeed: 8
        },
        ":": {
          tankSpeed: 3,
          tankTurn: 0.25,
          manSpeed: 4
        },
        ".": {
          tankSpeed: 12,
          tankTurn: 1,
          manSpeed: 16
        },
        "}": {
          tankSpeed: 0,
          tankTurn: 0,
          manSpeed: 0
        },
        "b": {
          tankSpeed: 16,
          tankTurn: 1,
          manSpeed: 16
        },
        "^": {
          tankSpeed: 3,
          tankTurn: 0.5,
          manSpeed: 0
        }
      };
      extendTerrainMap = function() {
        var ascii, attributes, key, results, type, value;
        results = [];
        for (ascii in TERRAIN_TYPE_ATTRIBUTES) {
          attributes = TERRAIN_TYPE_ATTRIBUTES[ascii];
          type = TERRAIN_TYPES[ascii];
          results.push((function() {
            var results1;
            results1 = [];
            for (key in attributes) {
              value = attributes[key];
              results1.push(type[key] = value);
            }
            return results1;
          })());
        }
        return results;
      };
      extendTerrainMap();
      WorldMapCell = class WorldMapCell extends Map.prototype.CellClass {
        constructor(map, x, y) {
          super(...arguments);
          this.life = 0;
        }
        isObstacle() {
          var ref;
          return ((ref = this.pill) != null ? ref.armour : void 0) > 0 || this.type.tankSpeed === 0;
        }
        // Does this cell contain a tank with a boat?
        hasTankOnBoat() {
          var i, len, ref, tank;
          ref = this.map.world.tanks;
          for (i = 0, len = ref.length; i < len; i++) {
            tank = ref[i];
            if (tank.armour !== 255 && tank.cell === this) {
              if (tank.onBoat) {
                return true;
              }
            }
          }
          return false;
        }
        getTankSpeed(tank) {
          var ref, ref1;
          if (((ref = this.pill) != null ? ref.armour : void 0) > 0) {
            return 0;
          }
          if ((ref1 = this.base) != null ? ref1.owner : void 0) {
            if (!(this.base.owner.$.isAlly(tank) || this.base.armour <= 9)) {
              return 0;
            }
          }
          if (tank.onBoat && this.isType("^", " ")) {
            return 16;
          }
          return this.type.tankSpeed;
        }
        getTankTurn(tank) {
          var ref, ref1;
          if (((ref = this.pill) != null ? ref.armour : void 0) > 0) {
            return 0;
          }
          if ((ref1 = this.base) != null ? ref1.owner : void 0) {
            if (!(this.base.owner.$.isAlly(tank) || this.base.armour <= 9)) {
              return 0;
            }
          }
          if (tank.onBoat && this.isType("^", " ")) {
            return 1;
          }
          return this.type.tankTurn;
        }
        getManSpeed(man) {
          var ref, ref1, tank;
          tank = man.owner.$;
          if (((ref = this.pill) != null ? ref.armour : void 0) > 0) {
            return 0;
          }
          if (((ref1 = this.base) != null ? ref1.owner : void 0) != null) {
            if (!(this.base.owner.$.isAlly(tank) || this.base.armour <= 9)) {
              return 0;
            }
          }
          return this.type.manSpeed;
        }
        getPixelCoordinates() {
          return [(this.x + 0.5) * TILE_SIZE_PIXELS, (this.y + 0.5) * TILE_SIZE_PIXELS];
        }
        getWorldCoordinates() {
          return [(this.x + 0.5) * TILE_SIZE_WORLD, (this.y + 0.5) * TILE_SIZE_WORLD];
        }
        setType(newType, mine, retileRadius) {
          var hadMine, oldLife, oldType, ref;
          [oldType, hadMine, oldLife] = [this.type, this.mine, this.life];
          super.setType(...arguments);
          this.life = (function() {
            switch (this.type.ascii) {
              case ".":
                return 5;
              case "}":
                return 5;
              case ":":
                return 5;
              case "~":
                return 4;
              default:
                return 0;
            }
          }).call(this);
          return (ref = this.map.world) != null ? ref.mapChanged(this, oldType, hadMine, oldLife) : void 0;
        }
        takeShellHit(shell) {
          var neigh, nextType, ref, ref1, sfx;
          sfx = sounds.SHOT_BUILDING;
          if (this.isType(".", "}", ":", "~")) {
            if (--this.life === 0) {
              nextType = (function() {
                switch (this.type.ascii) {
                  case ".":
                    return "~";
                  case "}":
                    return ":";
                  case ":":
                    return " ";
                  case "~":
                    return " ";
                }
              }).call(this);
              this.setType(nextType);
            } else {
              if ((ref = this.map.world) != null) {
                ref.mapChanged(this, this.type, this.mine);
              }
            }
          } else if (this.isType("#")) {
            this.setType(".");
            sfx = sounds.SHOT_TREE;
          } else if (this.isType("=")) {
            neigh = shell.direction >= 224 || shell.direction < 32 ? this.neigh(1, 0) : shell.direction >= 32 && shell.direction < 96 ? this.neigh(0, -1) : shell.direction >= 96 && shell.direction < 160 ? this.neigh(-1, 0) : this.neigh(0, 1);
            if (neigh.isType(" ", "^")) {
              this.setType(" ");
            }
          } else {
            nextType = (function() {
              switch (this.type.ascii) {
                case "|":
                  return "}";
                case "b":
                  return " ";
              }
            }).call(this);
            this.setType(nextType);
          }
          if (this.isType(" ")) {
            if ((ref1 = this.map.world) != null) {
              ref1.spawn(FloodFill, this);
            }
          }
          return sfx;
        }
        takeExplosionHit() {
          var ref;
          if (this.pill != null) {
            return this.pill.takeExplosionHit();
          }
          if (this.isType("b")) {
            this.setType(" ");
          } else if (!this.isType(" ", "^", "b")) {
            this.setType("%");
          } else {
            return;
          }
          return (ref = this.map.world) != null ? ref.spawn(FloodFill, this) : void 0;
        }
      };
      WorldMap = (function() {
        class WorldMap2 extends Map {
          // Get the cell at the given pixel coordinates, or return a dummy cell.
          cellAtPixel(x, y) {
            return this.cellAtTile(floor(x / TILE_SIZE_PIXELS), floor(y / TILE_SIZE_PIXELS));
          }
          // Get the cell at the given world coordinates, or return a dummy cell.
          cellAtWorld(x, y) {
            return this.cellAtTile(floor(x / TILE_SIZE_WORLD), floor(y / TILE_SIZE_WORLD));
          }
          getRandomStart() {
            return this.starts[round(random() * (this.starts.length - 1))];
          }
        }
        ;
        WorldMap2.prototype.CellClass = WorldMapCell;
        WorldMap2.prototype.PillboxClass = WorldPillbox;
        WorldMap2.prototype.BaseClass = WorldBase;
        return WorldMap2;
      }).call(exports);
      module.exports = WorldMap;
    }
  });

  // compiled/src/client/everard.js
  var require_everard = __commonJS({
    "compiled/src/client/everard.js"(exports, module) {
      module.exports = `Qk1BUEJPTE8BEAsQW5H/D2Vjbv8PZV90/w9lVHX/D2VwbP8PZYFr/w9lq27/D2WueP8PZa58/w9l
mpL/D2Veh/8PZWmJ/w9lcYn/D2Vsf/8PZWx4/w9lrYn/D2WBaP9aWlqvaf9aWlpWbv9aWlquev9a
Wlp5e/9aWlpsfP9aWlqLff9aWlpti/9aWlpVjf9aWlqlkv9aWlp+mP9aWlpMjABMfABcZA1sZAx8
ZAyMZAycZAysZAu4fAi4jAisnAWcnASMnAR8nARsnARcnAMQZk608fHx8fHx8fHx8fGRGGdNtaH0
tNUB8PCQkgGSAeIB4vHh8pKRHWhNtZGU9YUE1QHnlOcAxIIB4gHiAfKygdKQkoEfaU21gZT1lQTV
Ade05wSSgYIB4pHCAfKC8ZEAhJKBIGpNtYGEhfSFBNUBx9TXBIeC8bKBooHiofICgQSBgoEja021
gQSFhNUEhQTVAbf0xwSXEhwrGSAaIBwqGCAfKSFCsSBsTbWBBIUE5QSFBNWRl/TUl/KSsaIBkqGy
gfKCBKKBIG1NtYEEhQSFpIUEhQT1AZf0xwT3t7LxAfIB8oIEooEjbk21gQSFBIWEFUhQSFBKUHpQ
Gn1NcE9/fCAfKioeIEooECBvTbWBBIUEtQSFBIUE9QG3tOcE9/eygZL3p5HCBKKBIXBNtYEEhQS1
BIUEhQT1gbeU9wT394eSAaL3x5GiBKKBIHFNtYEEhdSFBIUE9RUffXIED355CHAff3lwGiBKKBAe
ck21gQT1hQSFBPUVH31wD09JQQeB9/eXsQSBgoEdc021gQT1hQSFBPUVH31yBA9+dAQHH399eAFA
sRl0TbWB9KSFFH9QH35wT39wD09PS0AJKBAddU21gbUH9QTl8QGH4QTx8RFJH394eFlxBICSgSJ2
TbWB9cUE1fGx0ATw8EBAEIcFlwCHhYcQeFl4WnFHooEgd021gfWFtLXx0QD0pAD0pDAQeVx4WXhR
cKcAhwS3gSJ4TbXhtQTl8QLREE8IAkBNAEkDQBCHBYcldZeF96cEt4EleU21gbcBtQTl8eEgQPRA
QEC0AJRAQBCHBYclBaeFl5XHBLWBJnpNtYG3AaUQSQtfHhkATwJASQBLBUBAELeVhwCHhceVhwSH
lYEje021gbcBpQD09PSUAJQgQJQgQNRwQEAQX3p4W3JXWXtYECd8TbWBtwGlkBQLXxAtEQSwRAQE
kASwdAQEBAEQhYeF9wW3JXXngSd9TbWBtwHVBMXx4SBAtCBAtAC0cEBAQBAJUHhZeVt5VHV1e1h4
ECp+TbWBtwHVBIXx8ZEwQEsATQBNB0BAEFcVeFlwWnBYcFl3V1dXVwWHgSd/TbWBtwGFsQSRp+EC
0UBAQPSEAPRAQBCHpZeVB5UXWXNXV7WHgSeATbWBt6GgBKeV8dFwQEBATQBPBUBAEPcFpwWHBZd1
dXV1cFh4ECSBTbWB96AEp5UH8aFAEECUANQgQNRAQECh15W3lUdXV7WHgSOCTbWB94CHBNUH8ZFC
AQTwBJAkBLB0BAQBAHsffHJXXngQI4NNtYHwgIcElcfxAYIgEPSEAJQAtACUQEAQt+HnFXxZeBAf
hE21gfCAhwTVhwGSsZIQHQBLAE0ATQEQ95fB97eBHIVNtYEAxwC3BKeVhwHyggCRAPQA9PSE98fx
4R6GTbWBEHoAewF01YcB8oKQAfDw8AGHBPe3gPe3gR6HTbWBIHCnALc0V1t4HyogDx8fGBhwT3x4
D3p4EByITbWBMHB6C3BNUHgfKyAfeg9+cE98eA95eRAeiU21gZD3IECXlRcfLCAYcAt8D3xxBPCA
l7D3B5Efik21gQeAB4DHAPT09LSHAKcAhwD09MQwcHsPcHkQK4tNtYEHgAeAxyBAh4CXAaKQFAwk
FwcKcApwCHAPeHBKCRBIEwQH0PcHkSaMTbWBB4AHgOQAh4CXAaKwwgGXEHwAew94eUEQkQSBAPQA
94eBKo1NtYEHgAeAFH0IeAh4GSkPJhcHBw9/engCQQkQSBgBQMcQegh4WHgQK45NtYEHgAeAh/CA
B4GSoPKBpwCHhccA15AHgCQQkQShFAxwCnAIeFh4ECmPTbWBhyBwh4CngIcAhwGioPISGnANegh6
UXCXgCQQ4QSwB9CHhYeBKZBNtYGHMHB5AHgAeAhwCHAZKw8hIafwtwWHhZCHEE0aSAhwDHANeBAo
kU21gYeQRwcHgASAhxB4GSsPISGnsPeFhwWAlwCk0QSAB/AXC3gQKpJNtYGnUHBweAB4CHIHGnsP
cH8YH3hYcVCXAIShAqEUCXEEhwCnALeBKJNNtYEHoEcHB4AHgAeAFxp7D3hwHnwbeFhwCXgJShxJ
CXkAeAt4ECaUTbWBB6BHBweAB4AnB4GnsJehpwH3p7G3gAeQBPGAFAp8C3kQIpVNtYGXAIcwcHgK
cgcbewh8GXAffnoceAlNEgdKD3l5ECCWTbWRhwCnEHgAegFxt7CHwZcB9/cH8fGBEH9ATHoQHZdN
tZGH8Aeggbewl6GnAfeHkfengPERDygrexAbmE21sfCXgAHHsKeBtwH34feHAPERDygpfRAQmU60
8fHx8fHx8fHx8fGRBP///w==`.split("\n").join("");
    }
  });

  // compiled/src/objects/fireball.js
  var require_fireball = __commonJS({
    "compiled/src/objects/fireball.js"(exports, module) {
      var BoloObject;
      var Explosion;
      var Fireball;
      var PI;
      var TILE_SIZE_WORLD;
      var cos;
      var round;
      var sin;
      var sounds;
      ({ round, cos, sin, PI } = Math);
      ({ TILE_SIZE_WORLD } = require_constants());
      sounds = require_sounds();
      BoloObject = require_object3();
      Explosion = require_explosion();
      Fireball = (function() {
        class Fireball2 extends BoloObject {
          serialization(isCreate, p) {
            if (isCreate) {
              p("B", "direction");
              p("f", "largeExplosion");
            }
            p("H", "x");
            p("H", "y");
            return p("B", "lifespan");
          }
          // Get the 1/16th direction step.
          getDirection16th() {
            return round((this.direction - 1) / 16) % 16;
          }
          //### World updates
          spawn(x1, y1, direction, largeExplosion) {
            this.x = x1;
            this.y = y1;
            this.direction = direction;
            this.largeExplosion = largeExplosion;
            return this.lifespan = 80;
          }
          update() {
            if (this.lifespan-- % 2 === 0) {
              if (this.wreck()) {
                return;
              }
              this.move();
            }
            if (this.lifespan === 0) {
              this.explode();
              return this.world.destroy(this);
            }
          }
          wreck() {
            var cell;
            this.world.spawn(Explosion, this.x, this.y);
            cell = this.world.map.cellAtWorld(this.x, this.y);
            if (cell.isType("^")) {
              this.world.destroy(this);
              this.soundEffect(sounds.TANK_SINKING);
              return true;
            } else if (cell.isType("b")) {
              cell.setType(" ");
              this.soundEffect(sounds.SHOT_BUILDING);
            } else if (cell.isType("#")) {
              cell.setType(".");
              this.soundEffect(sounds.SHOT_TREE);
            }
            return false;
          }
          move() {
            var ahead, dx, dy, newx, newy, radians;
            if (this.dx == null) {
              radians = (256 - this.direction) * 2 * PI / 256;
              this.dx = round(cos(radians) * 48);
              this.dy = round(sin(radians) * 48);
            }
            ({ dx, dy } = this);
            newx = this.x + dx;
            newy = this.y + dy;
            if (dx !== 0) {
              ahead = dx > 0 ? newx + 24 : newx - 24;
              ahead = this.world.map.cellAtWorld(ahead, newy);
              if (!ahead.isObstacle()) {
                this.x = newx;
              }
            }
            if (dy !== 0) {
              ahead = dy > 0 ? newy + 24 : newy - 24;
              ahead = this.world.map.cellAtWorld(newx, ahead);
              if (!ahead.isObstacle()) {
                return this.y = newy;
              }
            }
          }
          explode() {
            var builder, cell, cells, dx, dy, i, j, len, len1, ref, ref1, results, tank, x, y;
            cells = [this.world.map.cellAtWorld(this.x, this.y)];
            if (this.largeExplosion) {
              dx = this.dx > 0 ? 1 : -1;
              dy = this.dy > 0 ? 1 : -1;
              cells.push(cells[0].neigh(dx, 0));
              cells.push(cells[0].neigh(0, dy));
              cells.push(cells[0].neigh(dx, dy));
              this.soundEffect(sounds.BIG_EXPLOSION);
            } else {
              this.soundEffect(sounds.MINE_EXPLOSION);
            }
            results = [];
            for (i = 0, len = cells.length; i < len; i++) {
              cell = cells[i];
              cell.takeExplosionHit();
              ref = this.world.tanks;
              for (j = 0, len1 = ref.length; j < len1; j++) {
                tank = ref[j];
                if (builder = tank.builder.$) {
                  if ((ref1 = builder.order) !== builder.states.inTank && ref1 !== builder.states.parachuting) {
                    if (builder.cell === cell) {
                      builder.kill();
                    }
                  }
                }
              }
              [x, y] = cell.getWorldCoordinates();
              results.push(this.world.spawn(Explosion, x, y));
            }
            return results;
          }
        }
        ;
        Fireball2.prototype.styled = null;
        return Fireball2;
      }).call(exports);
      module.exports = Fireball;
    }
  });

  // compiled/src/objects/builder.js
  var require_builder = __commonJS({
    "compiled/src/objects/builder.js"(exports, module) {
      var BoloObject;
      var Builder;
      var MineExplosion;
      var TILE_SIZE_WORLD;
      var ceil;
      var cos;
      var distance;
      var floor;
      var heading;
      var min;
      var round;
      var sin;
      var sounds;
      ({ round, floor, ceil, min, cos, sin } = Math);
      ({ TILE_SIZE_WORLD } = require_constants());
      ({ distance, heading } = require_helpers());
      BoloObject = require_object3();
      sounds = require_sounds();
      MineExplosion = require_mine_explosion();
      Builder = (function() {
        class Builder2 extends BoloObject {
          // Builders are only ever spawned and destroyed on the server.
          constructor(world) {
            super(world);
            this.world = world;
            this.on("netUpdate", (changes) => {
              if (changes.hasOwnProperty("x") || changes.hasOwnProperty("y")) {
                return this.updateCell();
              }
            });
          }
          // Helper, called in several places that change builder position.
          updateCell() {
            return this.cell = this.x != null && this.y != null ? this.world.map.cellAtWorld(this.x, this.y) : null;
          }
          serialization(isCreate, p) {
            if (isCreate) {
              p("O", "owner");
            }
            p("B", "order");
            if (this.order === this.states.inTank) {
              this.x = this.y = null;
            } else {
              p("H", "x");
              p("H", "y");
              p("H", "targetX");
              p("H", "targetY");
              p("B", "trees");
              p("O", "pillbox");
              p("f", "hasMine");
            }
            if (this.order === this.states.waiting) {
              return p("B", "waitTimer");
            }
          }
          getTile() {
            if (this.order === this.states.parachuting) {
              return [16, 1];
            } else {
              return [17, floor(this.animation / 3)];
            }
          }
          performOrder(action, trees, cell) {
            var pill;
            if (this.order !== this.states.inTank) {
              return;
            }
            if (!(this.owner.$.onBoat || this.owner.$.cell === cell || this.owner.$.cell.getManSpeed(this) > 0)) {
              return;
            }
            pill = null;
            if (action === "mine") {
              if (this.owner.$.mines === 0) {
                return;
              }
              trees = 0;
            } else {
              if (this.owner.$.trees < trees) {
                return;
              }
              if (action === "pillbox") {
                if (!(pill = this.owner.$.getCarryingPillboxes().pop())) {
                  return;
                }
                pill.inTank = false;
                pill.carried = true;
              }
            }
            this.trees = trees;
            this.hasMine = action === "mine";
            this.ref("pillbox", pill);
            if (this.hasMine) {
              this.owner.$.mines--;
            }
            this.owner.$.trees -= trees;
            this.order = this.states.actions[action];
            this.x = this.owner.$.x;
            this.y = this.owner.$.y;
            [this.targetX, this.targetY] = cell.getWorldCoordinates();
            return this.updateCell();
          }
          kill() {
            var startingPos;
            if (!this.world.authority) {
              return;
            }
            this.soundEffect(sounds.MAN_DYING);
            this.order = this.states.parachuting;
            this.trees = 0;
            this.hasMine = false;
            if (this.pillbox) {
              this.pillbox.$.placeAt(this.cell);
              this.ref("pillbox", null);
            }
            if (this.owner.$.armour === 255) {
              [this.targetX, this.targetY] = [this.x, this.y];
            } else {
              [this.targetX, this.targetY] = [this.owner.$.x, this.owner.$.y];
            }
            startingPos = this.world.map.getRandomStart();
            return [this.x, this.y] = startingPos.cell.getWorldCoordinates();
          }
          //### World updates
          spawn(owner) {
            this.ref("owner", owner);
            return this.order = this.states.inTank;
          }
          anySpawn() {
            this.team = this.owner.$.team;
            return this.animation = 0;
          }
          update() {
            if (this.order === this.states.inTank) {
              return;
            }
            this.animation = (this.animation + 1) % 9;
            switch (this.order) {
              case this.states.waiting:
                if (this.waitTimer-- === 0) {
                  return this.order = this.states.returning;
                }
                break;
              case this.states.parachuting:
                return this.parachutingIn({
                  x: this.targetX,
                  y: this.targetY
                });
              case this.states.returning:
                if (this.owner.$.armour !== 255) {
                  return this.move(this.owner.$, 128, 160);
                }
                break;
              default:
                return this.move({
                  x: this.targetX,
                  y: this.targetY
                }, 16, 144);
            }
          }
          move(target, targetRadius, boatRadius) {
            var ahead, dx, dy, movementAxes, newx, newy, onBoat, rad, speed, targetCell;
            speed = this.cell.getManSpeed(this);
            onBoat = false;
            targetCell = this.world.map.cellAtWorld(this.targetX, this.targetY);
            if (speed === 0 && this.cell === targetCell) {
              speed = 16;
            }
            if (this.owner.$.armour !== 255 && this.owner.$.onBoat && distance(this, this.owner.$) < boatRadius) {
              onBoat = true;
              speed = 16;
            }
            speed = min(speed, distance(this, target));
            rad = heading(this, target);
            newx = this.x + (dx = round(cos(rad) * ceil(speed)));
            newy = this.y + (dy = round(sin(rad) * ceil(speed)));
            movementAxes = 0;
            if (dx !== 0) {
              ahead = this.world.map.cellAtWorld(newx, this.y);
              if (onBoat || ahead === targetCell || ahead.getManSpeed(this) > 0) {
                this.x = newx;
                movementAxes++;
              }
            }
            if (dy !== 0) {
              ahead = this.world.map.cellAtWorld(this.x, newy);
              if (onBoat || ahead === targetCell || ahead.getManSpeed(this) > 0) {
                this.y = newy;
                movementAxes++;
              }
            }
            if (movementAxes === 0) {
              return this.order = this.states.returning;
            } else {
              this.updateCell();
              if (distance(this, target) <= targetRadius) {
                return this.reached();
              }
            }
          }
          reached() {
            var used;
            if (this.order === this.states.returning) {
              this.order = this.states.inTank;
              this.x = this.y = null;
              if (this.pillbox) {
                this.pillbox.$.inTank = true;
                this.pillbox.$.carried = false;
                this.ref("pillbox", null);
              }
              this.owner.$.trees = min(40, this.owner.$.trees + this.trees);
              this.trees = 0;
              if (this.hasMine) {
                this.owner.$.mines = min(40, this.owner.$.mines + 1);
              }
              this.hasMine = false;
              return;
            }
            if (this.cell.mine) {
              this.world.spawn(MineExplosion, this.cell);
              this.order = this.states.waiting;
              this.waitTimer = 20;
              return;
            }
            switch (this.order) {
              case this.states.actions.forest:
                if (this.cell.base || this.cell.pill || !this.cell.isType("#")) {
                  break;
                }
                this.cell.setType(".");
                this.trees = 4;
                this.soundEffect(sounds.FARMING_TREE);
                break;
              case this.states.actions.road:
                if (this.cell.base || this.cell.pill || this.cell.isType("|", "}", "b", "^", "#", "=")) {
                  break;
                }
                if (this.cell.isType(" ") && this.cell.hasTankOnBoat()) {
                  break;
                }
                this.cell.setType("=");
                this.trees = 0;
                this.soundEffect(sounds.MAN_BUILDING);
                break;
              case this.states.actions.repair:
                if (this.cell.pill) {
                  used = this.cell.pill.repair(this.trees);
                  this.trees -= used;
                } else if (this.cell.isType("}")) {
                  this.cell.setType("|");
                  this.trees = 0;
                } else {
                  break;
                }
                this.soundEffect(sounds.MAN_BUILDING);
                break;
              case this.states.actions.boat:
                if (!(this.cell.isType(" ") && !this.cell.hasTankOnBoat())) {
                  break;
                }
                this.cell.setType("b");
                this.trees = 0;
                this.soundEffect(sounds.MAN_BUILDING);
                break;
              case this.states.actions.building:
                if (this.cell.base || this.cell.pill || this.cell.isType("b", "^", "#", "}", "|", " ")) {
                  break;
                }
                this.cell.setType("|");
                this.trees = 0;
                this.soundEffect(sounds.MAN_BUILDING);
                break;
              case this.states.actions.pillbox:
                if (this.cell.pill || this.cell.base || this.cell.isType("b", "^", "#", "|", "}", " ")) {
                  break;
                }
                this.pillbox.$.armour = 15;
                this.trees = 0;
                this.pillbox.$.placeAt(this.cell);
                this.ref("pillbox", null);
                this.soundEffect(sounds.MAN_BUILDING);
                break;
              case this.states.actions.mine:
                if (this.cell.base || this.cell.pill || this.cell.isType("^", " ", "|", "b", "}")) {
                  break;
                }
                this.cell.setType(null, true, 0);
                this.hasMine = false;
                this.soundEffect(sounds.MAN_LAY_MINE);
            }
            this.order = this.states.waiting;
            return this.waitTimer = 20;
          }
          parachutingIn(target) {
            var rad;
            if (distance(this, target) <= 16) {
              return this.order = this.states.returning;
            } else {
              rad = heading(this, target);
              this.x += round(cos(rad) * 3);
              this.y += round(sin(rad) * 3);
              return this.updateCell();
            }
          }
        }
        ;
        Builder2.prototype.states = {
          inTank: 0,
          waiting: 1,
          returning: 2,
          parachuting: 3,
          actions: {
            _min: 10,
            forest: 10,
            road: 11,
            repair: 12,
            boat: 13,
            building: 14,
            pillbox: 15,
            mine: 16
          }
        };
        Builder2.prototype.styled = true;
        return Builder2;
      }).call(exports);
      module.exports = Builder;
    }
  });

  // compiled/src/objects/tank.js
  var require_tank = __commonJS({
    "compiled/src/objects/tank.js"(exports, module) {
      var BoloObject;
      var Builder;
      var Explosion;
      var Fireball;
      var MineExplosion;
      var PI;
      var Shell;
      var TILE_SIZE_WORLD;
      var Tank;
      var ceil;
      var cos;
      var distance;
      var floor;
      var max;
      var min;
      var round;
      var sin;
      var sounds;
      var sqrt;
      ({ round, floor, ceil, min, sqrt, max, sin, cos, PI } = Math);
      ({ TILE_SIZE_WORLD } = require_constants());
      ({ distance } = require_helpers());
      BoloObject = require_object3();
      sounds = require_sounds();
      Explosion = require_explosion();
      MineExplosion = require_mine_explosion();
      Shell = require_shell();
      Fireball = require_fireball();
      Builder = require_builder();
      Tank = (function() {
        class Tank2 extends BoloObject {
          // Tanks are only ever spawned and destroyed on the server.
          constructor(world) {
            super(world);
            this.world = world;
            this.on("netUpdate", (changes) => {
              if (changes.hasOwnProperty("x") || changes.hasOwnProperty("y") || changes.armour === 255) {
                return this.updateCell();
              }
            });
          }
          // Keep the player list updated.
          anySpawn() {
            this.updateCell();
            this.world.addTank(this);
            return this.on("finalize", () => {
              return this.world.removeTank(this);
            });
          }
          // Helper, called in several places that change tank position.
          updateCell() {
            return this.cell = this.x != null && this.y != null ? this.world.map.cellAtWorld(this.x, this.y) : null;
          }
          // (Re)spawn the tank. Initializes all state. Only ever called on the server.
          reset() {
            var startingPos;
            startingPos = this.world.map.getRandomStart();
            [this.x, this.y] = startingPos.cell.getWorldCoordinates();
            this.direction = startingPos.direction * 16;
            this.updateCell();
            this.speed = 0;
            this.slideTicks = 0;
            this.slideDirection = 0;
            this.accelerating = false;
            this.braking = false;
            this.turningClockwise = false;
            this.turningCounterClockwise = false;
            this.turnSpeedup = 0;
            this.shells = 40;
            this.mines = 0;
            this.armour = 40;
            this.trees = 0;
            this.reload = 0;
            this.shooting = false;
            this.firingRange = 7;
            this.waterTimer = 0;
            return this.onBoat = true;
          }
          serialization(isCreate, p) {
            var ref;
            if (isCreate) {
              p("B", "team");
              p("O", "builder");
            }
            p("B", "armour");
            if (this.armour === 255) {
              p("O", "fireball");
              this.x = this.y = null;
              return;
            } else {
              if ((ref = this.fireball) != null) {
                ref.clear();
              }
            }
            p("H", "x");
            p("H", "y");
            p("B", "direction");
            p("B", "speed", {
              tx: function(v) {
                return v * 4;
              },
              rx: function(v) {
                return v / 4;
              }
            });
            p("B", "slideTicks");
            p("B", "slideDirection");
            p("B", "turnSpeedup", {
              tx: function(v) {
                return v + 50;
              },
              rx: function(v) {
                return v - 50;
              }
            });
            p("B", "shells");
            p("B", "mines");
            p("B", "trees");
            p("B", "reload");
            p("B", "firingRange", {
              tx: function(v) {
                return v * 2;
              },
              rx: function(v) {
                return v / 2;
              }
            });
            p("B", "waterTimer");
            p("f", "accelerating");
            p("f", "braking");
            p("f", "turningClockwise");
            p("f", "turningCounterClockwise");
            p("f", "shooting");
            return p("f", "onBoat");
          }
          // Get the 1/16th direction step.
          // FIXME: Should move our angle-related calculations to a separate module or so.
          getDirection16th() {
            return round((this.direction - 1) / 16) % 16;
          }
          getSlideDirection16th() {
            return round((this.slideDirection - 1) / 16) % 16;
          }
          // Return an array of pillboxes this tank is carrying.
          getCarryingPillboxes() {
            var i, len, pill, ref, ref1, results;
            ref = this.world.map.pills;
            results = [];
            for (i = 0, len = ref.length; i < len; i++) {
              pill = ref[i];
              if (pill.inTank && ((ref1 = pill.owner) != null ? ref1.$ : void 0) === this) {
                results.push(pill);
              }
            }
            return results;
          }
          // Get the tilemap index to draw. This is the index in styled.png.
          getTile() {
            var tx, ty;
            tx = this.getDirection16th();
            ty = this.onBoat ? 1 : 0;
            return [tx, ty];
          }
          // Tell whether the other tank is an ally.
          isAlly(other) {
            return other === this || this.team !== 255 && other.team === this.team;
          }
          // Adjust the firing range.
          increaseRange() {
            return this.firingRange = min(7, this.firingRange + 0.5);
          }
          decreaseRange() {
            return this.firingRange = max(1, this.firingRange - 0.5);
          }
          // We've taken a hit. Check if we were killed, otherwise slide and possibly kill our boat.
          takeShellHit(shell) {
            var largeExplosion;
            this.armour -= 5;
            if (this.armour < 0) {
              largeExplosion = this.shells + this.mines > 20;
              this.ref("fireball", this.world.spawn(Fireball, this.x, this.y, shell.direction, largeExplosion));
              this.kill();
            } else {
              this.slideTicks = 8;
              this.slideDirection = shell.direction;
              if (this.onBoat) {
                this.onBoat = false;
                this.speed = 0;
                if (this.cell.isType("^")) {
                  this.sink();
                }
              }
            }
            return sounds.HIT_TANK;
          }
          // We've taken a hit from a mine. Mostly similar to the above.
          takeMineHit() {
            var largeExplosion;
            this.armour -= 10;
            if (this.armour < 0) {
              largeExplosion = this.shells + this.mines > 20;
              this.ref("fireball", this.world.spawn(Fireball, this.x, this.y, this.direction, largeExplosion));
              return this.kill();
            } else if (this.onBoat) {
              this.onBoat = false;
              this.speed = 0;
              if (this.cell.isType("^")) {
                return this.sink();
              }
            }
          }
          //### World updates
          spawn(team) {
            this.team = team;
            this.reset();
            return this.ref("builder", this.world.spawn(Builder, this));
          }
          update() {
            if (this.death()) {
              return;
            }
            this.shootOrReload();
            this.turn();
            this.accelerate();
            this.fixPosition();
            return this.move();
          }
          destroy() {
            this.dropPillboxes();
            return this.world.destroy(this.builder.$);
          }
          death() {
            if (this.armour !== 255) {
              return false;
            }
            if (this.world.authority && --this.respawnTimer === 0) {
              delete this.respawnTimer;
              this.reset();
              return false;
            }
            return true;
          }
          shootOrReload() {
            if (this.reload > 0) {
              this.reload--;
            }
            if (!(this.shooting && this.reload === 0 && this.shells > 0)) {
              return;
            }
            this.shells--;
            this.reload = 13;
            this.world.spawn(Shell, this, {
              range: this.firingRange,
              onWater: this.onBoat
            });
            return this.soundEffect(sounds.SHOOTING);
          }
          turn() {
            var acceleration, maxTurn;
            maxTurn = this.cell.getTankTurn(this);
            if (this.turningClockwise === this.turningCounterClockwise) {
              this.turnSpeedup = 0;
              return;
            }
            if (this.turningCounterClockwise) {
              acceleration = maxTurn;
              if (this.turnSpeedup < 10) {
                acceleration /= 2;
              }
              if (this.turnSpeedup < 0) {
                this.turnSpeedup = 0;
              }
              this.turnSpeedup++;
            } else {
              acceleration = -maxTurn;
              if (this.turnSpeedup > -10) {
                acceleration /= 2;
              }
              if (this.turnSpeedup > 0) {
                this.turnSpeedup = 0;
              }
              this.turnSpeedup--;
            }
            this.direction += acceleration;
            while (this.direction < 0) {
              this.direction += 256;
            }
            if (this.direction >= 256) {
              return this.direction %= 256;
            }
          }
          accelerate() {
            var acceleration, maxSpeed;
            maxSpeed = this.cell.getTankSpeed(this);
            if (this.speed > maxSpeed) {
              acceleration = -0.25;
            } else if (this.accelerating === this.braking) {
              acceleration = 0;
            } else if (this.accelerating) {
              acceleration = 0.25;
            } else {
              acceleration = -0.25;
            }
            if (acceleration > 0 && this.speed < maxSpeed) {
              return this.speed = min(maxSpeed, this.speed + acceleration);
            } else if (acceleration < 0 && this.speed > 0) {
              return this.speed = max(0, this.speed + acceleration);
            }
          }
          fixPosition() {
            var halftile, i, len, other, ref, results;
            if (this.cell.getTankSpeed(this) === 0) {
              halftile = TILE_SIZE_WORLD / 2;
              if (this.x % TILE_SIZE_WORLD >= halftile) {
                this.x++;
              } else {
                this.x--;
              }
              if (this.y % TILE_SIZE_WORLD >= halftile) {
                this.y++;
              } else {
                this.y--;
              }
              this.speed = max(0, this.speed - 1);
            }
            ref = this.world.tanks;
            results = [];
            for (i = 0, len = ref.length; i < len; i++) {
              other = ref[i];
              if (other !== this && other.armour !== 255) {
                if (!(distance(this, other) > 255)) {
                  if (other.x < this.x) {
                    this.x++;
                  } else {
                    this.x--;
                  }
                  if (other.y < this.y) {
                    results.push(this.y++);
                  } else {
                    results.push(this.y--);
                  }
                } else {
                  results.push(void 0);
                }
              }
            }
            return results;
          }
          move() {
            var ahead, dx, dy, newx, newy, oldcell, rad, slowDown;
            dx = dy = 0;
            if (this.speed > 0) {
              rad = (256 - this.getDirection16th() * 16) * 2 * PI / 256;
              dx += round(cos(rad) * ceil(this.speed));
              dy += round(sin(rad) * ceil(this.speed));
            }
            if (this.slideTicks > 0) {
              rad = (256 - this.getSlideDirection16th() * 16) * 2 * PI / 256;
              dx += round(cos(rad) * 16);
              dy += round(sin(rad) * 16);
              this.slideTicks--;
            }
            newx = this.x + dx;
            newy = this.y + dy;
            slowDown = true;
            if (dx !== 0) {
              ahead = dx > 0 ? newx + 64 : newx - 64;
              ahead = this.world.map.cellAtWorld(ahead, newy);
              if (ahead.getTankSpeed(this) !== 0) {
                slowDown = false;
                if (!(this.onBoat && !ahead.isType(" ", "^") && this.speed < 16)) {
                  this.x = newx;
                }
              }
            }
            if (dy !== 0) {
              ahead = dy > 0 ? newy + 64 : newy - 64;
              ahead = this.world.map.cellAtWorld(newx, ahead);
              if (ahead.getTankSpeed(this) !== 0) {
                slowDown = false;
                if (!(this.onBoat && !ahead.isType(" ", "^") && this.speed < 16)) {
                  this.y = newy;
                }
              }
            }
            if (!(dx === 0 && dy === 0)) {
              if (slowDown) {
                this.speed = max(0, this.speed - 1);
              }
              oldcell = this.cell;
              this.updateCell();
              if (oldcell !== this.cell) {
                this.checkNewCell(oldcell);
              }
            }
            if (!this.onBoat && this.speed <= 3 && this.cell.isType(" ")) {
              if (++this.waterTimer === 15) {
                if (this.shells !== 0 || this.mines !== 0) {
                  this.soundEffect(sounds.BUBBLES);
                }
                this.shells = max(0, this.shells - 1);
                this.mines = max(0, this.mines - 1);
                return this.waterTimer = 0;
              }
            } else {
              return this.waterTimer = 0;
            }
          }
          checkNewCell(oldcell) {
            if (this.onBoat) {
              if (!this.cell.isType(" ", "^")) {
                this.leaveBoat(oldcell);
              }
            } else {
              if (this.cell.isType("^")) {
                return this.sink();
              }
              if (this.cell.isType("b")) {
                this.enterBoat();
              }
            }
            if (this.cell.mine) {
              return this.world.spawn(MineExplosion, this.cell);
            }
          }
          leaveBoat(oldcell) {
            var x, y;
            if (this.cell.isType("b")) {
              this.cell.setType(" ", false, 0);
              x = (this.cell.x + 0.5) * TILE_SIZE_WORLD;
              y = (this.cell.y + 0.5) * TILE_SIZE_WORLD;
              this.world.spawn(Explosion, x, y);
              return this.world.soundEffect(sounds.SHOT_BUILDING, x, y);
            } else {
              if (oldcell.isType(" ")) {
                oldcell.setType("b", false, 0);
              }
              return this.onBoat = false;
            }
          }
          enterBoat() {
            this.cell.setType(" ", false, 0);
            return this.onBoat = true;
          }
          sink() {
            this.world.soundEffect(sounds.TANK_SINKING, this.x, this.y);
            return this.kill();
          }
          kill() {
            this.dropPillboxes();
            this.x = this.y = null;
            this.armour = 255;
            return this.respawnTimer = 255;
          }
          // Drop all pillboxes we own in a neat square area.
          dropPillboxes() {
            var cell, delta, ey, i, pill, pills, ref, ref1, sy, width, x, y;
            pills = this.getCarryingPillboxes();
            if (pills.length === 0) {
              return;
            }
            x = this.cell.x;
            sy = this.cell.y;
            width = sqrt(pills.length);
            delta = floor(width / 2);
            width = round(width);
            x -= delta;
            sy -= delta;
            ey = sy + width;
            while (pills.length !== 0) {
              for (y = i = ref = sy, ref1 = ey; ref <= ref1 ? i < ref1 : i > ref1; y = ref <= ref1 ? ++i : --i) {
                cell = this.world.map.cellAtTile(x, y);
                if (cell.base != null || cell.pill != null || cell.isType("|", "}", "b")) {
                  continue;
                }
                if (!(pill = pills.pop())) {
                  return;
                }
                pill.placeAt(cell);
              }
              x += 1;
            }
          }
        }
        ;
        Tank2.prototype.styled = true;
        return Tank2;
      }).call(exports);
      module.exports = Tank;
    }
  });

  // compiled/src/objects/all.js
  var require_all = __commonJS({
    "compiled/src/objects/all.js"(exports) {
      exports.registerWithWorld = function(w) {
        w.registerType(require_world_pillbox());
        w.registerType(require_world_base());
        w.registerType(require_flood_fill());
        w.registerType(require_tank());
        w.registerType(require_explosion());
        w.registerType(require_mine_explosion());
        w.registerType(require_shell());
        w.registerType(require_fireball());
        return w.registerType(require_builder());
      };
    }
  });

  // compiled/src/client/base64.js
  var require_base64 = __commonJS({
    "compiled/src/client/base64.js"(exports) {
      var decodeBase64;
      decodeBase64 = function(input) {
        var c, cc, i, j, len, output, outputIndex, outputLength, quad, quadIndex, tail;
        if (input.length % 4 !== 0) {
          throw new Error("Invalid base64 input length, not properly padded?");
        }
        outputLength = input.length / 4 * 3;
        tail = input.substr(-2);
        if (tail[0] === "=") {
          outputLength--;
        }
        if (tail[1] === "=") {
          outputLength--;
        }
        output = new Array(outputLength);
        quad = new Array(4);
        outputIndex = 0;
        for (i = j = 0, len = input.length; j < len; i = ++j) {
          c = input[i];
          cc = c.charCodeAt(0);
          quadIndex = i % 4;
          quad[quadIndex] = (function() {
            if (65 <= cc && cc <= 90) {
              return cc - 65;
            } else if (97 <= cc && cc <= 122) {
              return cc - 71;
            } else if (48 <= cc && cc <= 57) {
              return cc + 4;
            } else if (cc === 43) {
              return 62;
            } else if (cc === 47) {
              return 63;
            } else if (cc === 61) {
              return -1;
            } else {
              throw new Error(`Invalid base64 input character: ${c}`);
            }
          })();
          if (quadIndex !== 3) {
            continue;
          }
          output[outputIndex++] = ((quad[0] & 63) << 2) + ((quad[1] & 48) >> 4);
          if (quad[2] !== -1) {
            output[outputIndex++] = ((quad[1] & 15) << 4) + ((quad[2] & 60) >> 2);
          }
          if (quad[3] !== -1) {
            output[outputIndex++] = ((quad[2] & 3) << 6) + (quad[3] & 63);
          }
        }
        return output;
      };
      exports.decodeBase64 = decodeBase64;
    }
  });

  // compiled/node_modules/villain/loop.js
  var require_loop = __commonJS({
    "compiled/node_modules/villain/loop.js"(exports) {
      (function() {
        var actualCAF, actualRAF, i, len, prefix, ref;
        if (typeof window !== "undefined" && window !== null) {
          if (actualRAF = window.requestAnimationFrame) {
            actualCAF = window.cancelAnimationFrame || window.cancelRequestAnimationFrame;
          } else {
            ref = ["moz", "webkit", "ms", "o"];
            for (i = 0, len = ref.length; i < len; i++) {
              prefix = ref[i];
              if (actualRAF = window[`${prefix}RequestAnimationFrame`]) {
                actualCAF = window[`${prefix}CancelAnimationFrame`] || window[`${prefix}CancelRequestAnimationFrame`];
                break;
              }
            }
          }
          if (actualRAF) {
            actualRAF = actualRAF.bind(window);
            if (actualCAF) {
              actualCAF = actualCAF.bind(window);
            }
          }
          if (!actualRAF) {
            actualRAF = function(callback) {
              callback();
              return null;
            };
            actualCAF = function(timeout) {
              return null;
            };
          }
        } else {
          actualRAF = process.nextTick;
          actualCAF = null;
        }
        if (!actualCAF) {
          exports.requestAnimationFrame = function(callback) {
            var state;
            state = {
              active: true
            };
            actualRAF(function() {
              if (state.active) {
                return callback();
              }
            });
            return state;
          };
          return exports.cancelAnimationFrame = function(state) {
            return state.active = false;
          };
        } else {
          exports.requestAnimationFrame = actualRAF;
          return exports.cancelAnimationFrame = actualCAF;
        }
      })();
      exports.createLoop = function(options = {}) {
        var frameCallback, frameReq, handle, lastTick, timerCallback, timerReq;
        lastTick = timerReq = frameReq = null;
        timerCallback = function() {
          var now;
          timerReq = null;
          now = Date.now();
          while (now - lastTick >= options.rate) {
            options.tick();
            lastTick += options.rate;
          }
          if (typeof options.idle === "function") {
            options.idle();
          }
          if (options.frame && !frameReq) {
            frameReq = exports.requestAnimationFrame(frameCallback);
          }
          return timerReq = setTimeout(timerCallback, options.rate);
        };
        frameCallback = function() {
          frameReq = null;
          return options.frame();
        };
        handle = {
          start: function() {
            if (!timerReq) {
              lastTick = Date.now();
              return timerReq = setTimeout(timerCallback, options.rate);
            }
          },
          stop: function() {
            if (timerReq) {
              clearInterval(timerReq);
              timerReq = null;
            }
            if (frameReq) {
              exports.cancelAnimationFrame(frameReq);
              return frameReq = null;
            }
          }
        };
        return handle;
      };
    }
  });

  // compiled/src/client/progress.js
  var require_progress = __commonJS({
    "compiled/src/client/progress.js"(exports, module) {
      var EventEmitter;
      var Progress;
      ({ EventEmitter } = require_events());
      Progress = class Progress extends EventEmitter {
        constructor(initialAmount) {
          super();
          this.lengthComputable = true;
          this.loaded = 0;
          this.total = initialAmount != null ? initialAmount : 0;
          this.wrappingUp = false;
        }
        // Add the given amount to the total. `amount` is optional, and defaults to 1. The return value is
        // a function that is a shortcut for `step(amount)`, and can be used as a callback for an event
        // listener. If given, the returned function will call `cb` as well, allowing for chaining.
        add(...args) {
          var amount, cb;
          if (typeof args[0] === "number") {
            amount = args.shift();
          } else {
            amount = 1;
          }
          if (typeof args[0] === "function") {
            cb = args.shift();
          } else {
            cb = null;
          }
          this.total += amount;
          this.emit("progress", this);
          return () => {
            this.step(amount);
            return typeof cb === "function" ? cb() : void 0;
          };
        }
        // Mark the given amount as loaded. `amount` is optional, and defaults to 1.
        step(amount) {
          if (amount == null) {
            amount = 1;
          }
          this.loaded += amount;
          this.emit("progress", this);
          return this.checkComplete();
        }
        // Reset the both `total` and `loaded` counters.
        set(total, loaded) {
          this.total = total;
          this.loaded = loaded;
          this.emit("progress", this);
          return this.checkComplete();
        }
        // Signal that all tasks are running, and no further `add` calls will be made. From this point on,
        // a `complete` event may be emitted. (Note: it may also be emitted from *within* this method.)
        wrapUp() {
          this.wrappingUp = true;
          return this.checkComplete();
        }
        // An internal helper that emits the 'complete' signal when appropriate.
        checkComplete() {
          if (!(this.wrappingUp && this.loaded >= this.total)) {
            return;
          }
          return this.emit("complete");
        }
      };
      module.exports = Progress;
    }
  });

  // compiled/src/client/vignette.js
  var require_vignette = __commonJS({
    "compiled/src/client/vignette.js"(exports, module) {
      var Vignette;
      Vignette = class Vignette {
        constructor() {
          this.container = $('<div class="vignette"/>').appendTo("body");
          this.messageLine = $('<div class="vignette-message"/>').appendTo(this.container);
        }
        message(text) {
          return this.messageLine.text(text);
        }
        showProgress() {
        }
        // FIXME
        hideProgress() {
        }
        // FIXME
        progress(p) {
        }
        // FIXME
        destroy() {
          this.container.remove();
          return this.container = this.messageLine = null;
        }
      };
      module.exports = Vignette;
    }
  });

  // compiled/src/client/soundkit.js
  var require_soundkit = __commonJS({
    "compiled/src/client/soundkit.js"(exports, module) {
      var SoundKit;
      SoundKit = class SoundKit {
        constructor() {
          var dummy;
          this.sounds = {};
          this.isSupported = false;
          if (typeof Audio !== "undefined" && Audio !== null) {
            dummy = new Audio();
            this.isSupported = dummy.canPlayType != null;
          }
        }
        // Register the effect at the given url with the given name, and build a helper method
        // on this instance to play the sound effect.
        register(name, url) {
          this.sounds[name] = url;
          return this[name] = () => {
            return this.play(name);
          };
        }
        // Wait for the given effect to be loaded, then register it.
        load(name, url, cb) {
          var loader;
          this.register(name, url);
          if (!this.isSupported) {
            return typeof cb === "function" ? cb() : void 0;
          }
          loader = new Audio();
          if (cb) {
            $(loader).one("canplaythrough", cb);
          }
          $(loader).one("error", (e) => {
            switch (e.code) {
              case e.MEDIA_ERR_SRC_NOT_SUPPORTED:
                this.isSupported = false;
                return typeof cb === "function" ? cb() : void 0;
            }
          });
          loader.src = url;
          return loader.load();
        }
        // Play the effect called `name`.
        play(name) {
          var effect;
          if (!this.isSupported) {
            return;
          }
          effect = new Audio();
          effect.src = this.sounds[name];
          effect.play();
          return effect;
        }
      };
      module.exports = SoundKit;
    }
  });

  // compiled/src/team_colors.js
  var require_team_colors = __commonJS({
    "compiled/src/team_colors.js"(exports, module) {
      var TEAM_COLORS;
      TEAM_COLORS = [
        {
          // Primaries:
          r: 255,
          g: 0,
          b: 0,
          name: "red"
        },
        {
          r: 0,
          g: 0,
          b: 255,
          name: "blue"
        },
        {
          r: 0,
          g: 255,
          b: 0,
          name: "green"
        },
        {
          // Secondaries:
          r: 0,
          g: 255,
          b: 255,
          name: "cyan"
        },
        {
          r: 255,
          g: 255,
          b: 0,
          name: "yellow"
        },
        {
          r: 255,
          g: 0,
          b: 255,
          name: "magenta"
        }
      ];
      module.exports = TEAM_COLORS;
    }
  });

  // compiled/src/client/renderer/base.js
  var require_base2 = __commonJS({
    "compiled/src/client/renderer/base.js"(exports, module) {
      var BaseRenderer;
      var MAP_SIZE_PIXELS;
      var PI;
      var PIXEL_SIZE_WORLD;
      var TEAM_COLORS;
      var TILE_SIZE_PIXELS;
      var TILE_SIZE_WORLD;
      var cos;
      var max;
      var min;
      var round;
      var sin;
      var sounds;
      var sqrt;
      ({ min, max, round, cos, sin, PI, sqrt } = Math);
      ({ TILE_SIZE_PIXELS, TILE_SIZE_WORLD, PIXEL_SIZE_WORLD, MAP_SIZE_PIXELS } = require_constants());
      sounds = require_sounds();
      TEAM_COLORS = require_team_colors();
      BaseRenderer = class BaseRenderer {
        // The constructor takes a reference to the World it needs to draw. Once the constructor finishes,
        // `Map#setView` is called to hook up this renderer instance, which causes onRetile to be invoked
        // once for each tile to initialize.
        constructor(world) {
          this.world = world;
          this.images = this.world.images;
          this.soundkit = this.world.soundkit;
          this.canvas = $("<canvas/>").appendTo("body");
          this.lastCenter = this.world.map.findCenterCell().getWorldCoordinates();
          this.mouse = [0, 0];
          this.canvas.click((e) => {
            return this.handleClick(e);
          });
          this.canvas.mousemove((e) => {
            return this.mouse = [e.pageX, e.pageY];
          });
          this.setup();
          this.handleResize();
          $(window).resize(() => {
            return this.handleResize();
          });
        }
        // Subclasses use this as their constructor.
        setup() {
        }
        // This methods takes x and y coordinates to center the screen on. The callback provided should be
        // invoked exactly once. Any drawing operations used from within the callback will have a
        // translation applied so that the given coordinates become the center on the screen.
        centerOn(x, y, cb) {
        }
        // Draw the tile (tx,ty), which are x and y indices in the base tilemap (and not pixel
        // coordinates), so that the top left corner of the tile is placed at (sdx,sdy) pixel coordinates
        // on the screen. The destination coordinates may be subject to translation from centerOn.
        drawTile(tx, ty, sdx, sdy) {
        }
        // Similar to drawTile, but draws from the styled tilemap. Takes an additional parameter `style`,
        // which is a selection from the team colors. The overlay tile is drawn in this color on top of
        // the tile from the styled tilemap. If the style doesn't exist, no overlay is drawn.
        drawStyledTile(tx, ty, style, sdx, sdy) {
        }
        // Draw the map section that intersects with the given boundary box (sx,sy,w,h). The boundary
        // box is given in pixel coordinates. This may very well be a no-op if the renderer can do all of
        // its work in onRetile.
        drawMap(sx, sy, w, h) {
        }
        // Draw an arrow towards the builder. Only called when the builder is outside the tank.
        drawBuilderIndicator(builder) {
        }
        // Inherited from MapView.
        onRetile(cell, tx, ty) {
        }
        //### Common functions.
        // Draw a single frame.
        draw() {
          var x, y;
          if (this.world.player) {
            ({ x, y } = this.world.player);
            if (this.world.player.fireball != null) {
              ({ x, y } = this.world.player.fireball.$);
            }
          } else {
            x = y = null;
          }
          if (!(x != null && y != null)) {
            [x, y] = this.lastCenter;
          } else {
            this.lastCenter = [x, y];
          }
          this.centerOn(x, y, (left, top, width, height) => {
            var i, len, obj, ox, oy, ref, tx, ty;
            this.drawMap(left, top, width, height);
            ref = this.world.objects;
            for (i = 0, len = ref.length; i < len; i++) {
              obj = ref[i];
              if (!(obj.styled != null && obj.x != null && obj.y != null)) {
                continue;
              }
              [tx, ty] = obj.getTile();
              ox = round(obj.x / PIXEL_SIZE_WORLD) - TILE_SIZE_PIXELS / 2;
              oy = round(obj.y / PIXEL_SIZE_WORLD) - TILE_SIZE_PIXELS / 2;
              switch (obj.styled) {
                case true:
                  this.drawStyledTile(tx, ty, obj.team, ox, oy);
                  break;
                case false:
                  this.drawTile(tx, ty, ox, oy);
              }
            }
            return this.drawOverlay();
          });
          if (this.hud) {
            return this.updateHud();
          }
        }
        // Play a sound effect.
        playSound(sfx, x, y, owner) {
          var dist, dx, dy, mode, name;
          mode = this.world.player && owner === this.world.player ? "Self" : (dx = x - this.lastCenter[0], dy = y - this.lastCenter[1], dist = sqrt(dx * dx + dy * dy), dist > 40 * TILE_SIZE_WORLD ? "None" : dist > 15 * TILE_SIZE_WORLD ? "Far" : "Near");
          if (mode === "None") {
            return;
          }
          name = (function() {
            switch (sfx) {
              case sounds.BIG_EXPLOSION:
                return `bigExplosion${mode}`;
              case sounds.BUBBLES:
                if (mode === "Self") {
                  return "bubbles";
                }
                break;
              case sounds.FARMING_TREE:
                return `farmingTree${mode}`;
              case sounds.HIT_TANK:
                return `hitTank${mode}`;
              case sounds.MAN_BUILDING:
                return `manBuilding${mode}`;
              case sounds.MAN_DYING:
                return `manDying${mode}`;
              case sounds.MAN_LAY_MINE:
                if (mode === "Near") {
                  return "manLayMineNear";
                }
                break;
              case sounds.MINE_EXPLOSION:
                return `mineExplosion${mode}`;
              case sounds.SHOOTING:
                return `shooting${mode}`;
              case sounds.SHOT_BUILDING:
                return `shotBuilding${mode}`;
              case sounds.SHOT_TREE:
                return `shotTree${mode}`;
              case sounds.TANK_SINKING:
                return `tankSinking${mode}`;
            }
          })();
          if (name) {
            return this.soundkit[name]();
          }
        }
        handleResize() {
          this.canvas[0].width = window.innerWidth;
          this.canvas[0].height = window.innerHeight;
          this.canvas.css({
            width: window.innerWidth + "px",
            height: window.innerHeight + "px"
          });
          return $("body").css({
            width: window.innerWidth + "px",
            height: window.innerHeight + "px"
          });
        }
        handleClick(e) {
          var action, cell, flexible, mx, my, trees;
          e.preventDefault();
          this.world.input.focus();
          if (!this.currentTool) {
            return;
          }
          [mx, my] = this.mouse;
          cell = this.getCellAtScreen(mx, my);
          [action, trees, flexible] = this.world.checkBuildOrder(this.currentTool, cell);
          if (action) {
            return this.world.buildOrder(action, trees, cell);
          }
        }
        // Get the view area in pixel coordinates when looking at the given world coordinates.
        getViewAreaAtWorld(x, y) {
          var height, left, top, width;
          ({ width, height } = this.canvas[0]);
          left = round(x / PIXEL_SIZE_WORLD - width / 2);
          left = max(0, min(MAP_SIZE_PIXELS - width, left));
          top = round(y / PIXEL_SIZE_WORLD - height / 2);
          top = max(0, min(MAP_SIZE_PIXELS - height, top));
          return [left, top, width, height];
        }
        // Get the map cell at the given screen coordinates.
        getCellAtScreen(x, y) {
          var cameraX, cameraY, height, left, top, width;
          [cameraX, cameraY] = this.lastCenter;
          [left, top, width, height] = this.getViewAreaAtWorld(cameraX, cameraY);
          return this.world.map.cellAtPixel(left + x, top + y);
        }
        //### HUD elements
        // Draw HUD elements that overlay the map. These are elements that need to be drawn in regular
        // game coordinates, rather than screen coordinates.
        drawOverlay() {
          var b, player;
          if ((player = this.world.player) && player.armour !== 255) {
            b = player.builder.$;
            if (!(b.order === b.states.inTank || b.order === b.states.parachuting)) {
              this.drawBuilderIndicator(b);
            }
            this.drawReticle();
          }
          this.drawNames();
          return this.drawCursor();
        }
        drawReticle() {
          var distance, rad, x, y;
          distance = this.world.player.firingRange * TILE_SIZE_PIXELS;
          rad = (256 - this.world.player.direction) * 2 * PI / 256;
          x = round(this.world.player.x / PIXEL_SIZE_WORLD + cos(rad) * distance) - TILE_SIZE_PIXELS / 2;
          y = round(this.world.player.y / PIXEL_SIZE_WORLD + sin(rad) * distance) - TILE_SIZE_PIXELS / 2;
          return this.drawTile(17, 4, x, y);
        }
        drawCursor() {
          var cell, mx, my;
          [mx, my] = this.mouse;
          cell = this.getCellAtScreen(mx, my);
          return this.drawTile(18, 6, cell.x * TILE_SIZE_PIXELS, cell.y * TILE_SIZE_PIXELS);
        }
        // Create the HUD container.
        initHud() {
          this.hud = $("<div/>").appendTo("body");
          this.initHudTankStatus();
          this.initHudPillboxes();
          this.initHudBases();
          this.initHudToolSelect();
          this.initHudNotices();
          return this.updateHud();
        }
        initHudTankStatus() {
          var bar, container, i, indicator, len, ref;
          container = $("<div/>", {
            id: "tankStatus"
          }).appendTo(this.hud);
          $("<div/>", {
            class: "deco"
          }).appendTo(container);
          this.tankIndicators = {};
          ref = ["shells", "mines", "armour", "trees"];
          for (i = 0, len = ref.length; i < len; i++) {
            indicator = ref[i];
            bar = $("<div/>", {
              class: "gauge",
              id: `tank-${indicator}`
            }).appendTo(container);
            this.tankIndicators[indicator] = $('<div class="gauge-content"></div>').appendTo(bar);
          }
        }
        // Create the pillbox status indicator.
        initHudPillboxes() {
          var container, node, pill;
          container = $("<div/>", {
            id: "pillStatus"
          }).appendTo(this.hud);
          $("<div/>", {
            class: "deco"
          }).appendTo(container);
          this.pillIndicators = (function() {
            var i, len, ref, results;
            ref = this.world.map.pills;
            results = [];
            for (i = 0, len = ref.length; i < len; i++) {
              pill = ref[i];
              node = $("<div/>", {
                class: "pill"
              }).appendTo(container);
              results.push([node, pill]);
            }
            return results;
          }).call(this);
        }
        // Create the base status indicator.
        initHudBases() {
          var base, container, node;
          container = $("<div/>", {
            id: "baseStatus"
          }).appendTo(this.hud);
          $("<div/>", {
            class: "deco"
          }).appendTo(container);
          this.baseIndicators = (function() {
            var i, len, ref, results;
            ref = this.world.map.bases;
            results = [];
            for (i = 0, len = ref.length; i < len; i++) {
              base = ref[i];
              node = $("<div/>", {
                class: "base"
              }).appendTo(container);
              results.push([node, base]);
            }
            return results;
          }).call(this);
        }
        // Create the build tool selection
        initHudToolSelect() {
          var i, len, ref, toolType, tools;
          this.currentTool = null;
          tools = $('<div id="tool-select" />').appendTo(this.hud);
          ref = ["forest", "road", "building", "pillbox", "mine"];
          for (i = 0, len = ref.length; i < len; i++) {
            toolType = ref[i];
            this.initHudTool(tools, toolType);
          }
          return tools.buttonset();
        }
        // Create a single build tool item.
        initHudTool(tools, toolType) {
          var label, tool, toolname;
          toolname = `tool-${toolType}`;
          tool = $("<input/>", {
            type: "radio",
            name: "tool",
            id: toolname
          }).appendTo(tools);
          label = $("<label/>", {
            for: toolname
          }).appendTo(tools);
          label.append($("<span/>", {
            class: `bolo-tool bolo-${toolname}`
          }));
          return tool.click((e) => {
            if (this.currentTool === toolType) {
              this.currentTool = null;
              tools.find("input").removeAttr("checked");
              tools.buttonset("refresh");
            } else {
              this.currentTool = toolType;
            }
            return this.world.input.focus();
          });
        }
        // Show WIP notice and Github ribbon. These are really a temporary hacks, so FIXME someday.
        initHudNotices() {
          if (location.hostname.split(".")[1] === "github") {
            $("<div/>").html(`This is a work-in-progress; less than alpha quality!<br>
To see multiplayer in action, follow instructions on Github.`).css({
              "position": "absolute",
              "top": "70px",
              "left": "0px",
              "width": "100%",
              "text-align": "center",
              "font-family": "monospace",
              "font-size": "16px",
              "font-weight": "bold",
              "color": "white"
            }).appendTo(this.hud);
          }
          if (location.hostname.split(".")[1] === "github" || location.hostname.substr(-6) === ".no.de") {
            return $('<a href="http://github.com/stephank/orona"></a>').css({
              "position": "absolute",
              "top": "0px",
              "right": "0px"
            }).html('<img src="http://s3.amazonaws.com/github/ribbons/forkme_right_darkblue_121621.png" alt="Fork me on GitHub">').appendTo(this.hud);
          }
        }
        // Update the HUD elements.
        updateHud() {
          var base, color, i, j, len, len1, node, p, pill, prop, ref, ref1, ref2, results, statuskey, value;
          ref = this.pillIndicators;
          for (i = 0, len = ref.length; i < len; i++) {
            [node, pill] = ref[i];
            statuskey = `${pill.inTank};${pill.carried};${pill.armour};${pill.team}`;
            if (pill.hudStatusKey === statuskey) {
              continue;
            }
            pill.hudStatusKey = statuskey;
            if (pill.inTank || pill.carried) {
              node.attr("status", "carried");
            } else if (pill.armour === 0) {
              node.attr("status", "dead");
            } else {
              node.attr("status", "healthy");
            }
            color = TEAM_COLORS[pill.team] || {
              r: 112,
              g: 112,
              b: 112
            };
            node.css({
              "background-color": `rgb(${color.r},${color.g},${color.b})`
            });
          }
          ref1 = this.baseIndicators;
          for (j = 0, len1 = ref1.length; j < len1; j++) {
            [node, base] = ref1[j];
            statuskey = `${base.armour};${base.team}`;
            if (base.hudStatusKey === statuskey) {
              continue;
            }
            base.hudStatusKey = statuskey;
            if (base.armour <= 9) {
              node.attr("status", "vulnerable");
            } else {
              node.attr("status", "healthy");
            }
            color = TEAM_COLORS[base.team] || {
              r: 112,
              g: 112,
              b: 112
            };
            node.css({
              "background-color": `rgb(${color.r},${color.g},${color.b})`
            });
          }
          p = this.world.player;
          p.hudLastStatus || (p.hudLastStatus = {});
          ref2 = this.tankIndicators;
          results = [];
          for (prop in ref2) {
            node = ref2[prop];
            value = p.armour === 255 ? 0 : p[prop];
            if (p.hudLastStatus[prop] === value) {
              continue;
            }
            p.hudLastStatus[prop] = value;
            results.push(node.css({
              height: `${round(value / 40 * 100)}%`
            }));
          }
          return results;
        }
      };
      module.exports = BaseRenderer;
    }
  });

  // compiled/src/client/renderer/common_2d.js
  var require_common_2d = __commonJS({
    "compiled/src/client/renderer/common_2d.js"(exports, module) {
      var BaseRenderer;
      var Common2dRenderer;
      var PI;
      var PIXEL_SIZE_WORLD;
      var TEAM_COLORS;
      var TILE_SIZE_PIXELS;
      var cos;
      var distance;
      var heading;
      var min;
      var round;
      var sin;
      ({ min, round, PI, sin, cos } = Math);
      ({ TILE_SIZE_PIXELS, PIXEL_SIZE_WORLD } = require_constants());
      ({ distance, heading } = require_helpers());
      BaseRenderer = require_base2();
      TEAM_COLORS = require_team_colors();
      Common2dRenderer = class Common2dRenderer extends BaseRenderer {
        setup() {
          var ctx, e, imageData, img, temp;
          try {
            this.ctx = this.canvas[0].getContext("2d");
            this.ctx.drawImage;
          } catch (error) {
            e = error;
            throw `Could not initialize 2D canvas: ${e.message}`;
          }
          img = this.images.overlay;
          temp = $("<canvas/>")[0];
          temp.width = img.width;
          temp.height = img.height;
          ctx = temp.getContext("2d");
          ctx.globalCompositeOperation = "copy";
          ctx.drawImage(img, 0, 0);
          imageData = ctx.getImageData(0, 0, img.width, img.height);
          this.overlay = imageData.data;
          return this.prestyled = {};
        }
        // We use an extra parameter `ctx` here, so that the offscreen renderer can
        // use the context specific to segments.
        drawTile(tx, ty, dx, dy, ctx) {
          return (ctx || this.ctx).drawImage(this.images.base, tx * TILE_SIZE_PIXELS, ty * TILE_SIZE_PIXELS, TILE_SIZE_PIXELS, TILE_SIZE_PIXELS, dx, dy, TILE_SIZE_PIXELS, TILE_SIZE_PIXELS);
        }
        createPrestyled(color) {
          var base, ctx, data, factor, height, i, imageData, j, k, ref, ref1, source, width, x, y;
          base = this.images.styled;
          ({ width, height } = base);
          source = $("<canvas/>")[0];
          source.width = width;
          source.height = height;
          ctx = source.getContext("2d");
          ctx.globalCompositeOperation = "copy";
          ctx.drawImage(base, 0, 0);
          imageData = ctx.getImageData(0, 0, width, height);
          data = imageData.data;
          for (x = j = 0, ref = width; 0 <= ref ? j < ref : j > ref; x = 0 <= ref ? ++j : --j) {
            for (y = k = 0, ref1 = height; 0 <= ref1 ? k < ref1 : k > ref1; y = 0 <= ref1 ? ++k : --k) {
              i = 4 * (y * width + x);
              factor = this.overlay[i] / 255;
              data[i + 0] = round(factor * color.r + (1 - factor) * data[i + 0]);
              data[i + 1] = round(factor * color.g + (1 - factor) * data[i + 1]);
              data[i + 2] = round(factor * color.b + (1 - factor) * data[i + 2]);
              data[i + 3] = min(255, data[i + 3] + this.overlay[i]);
            }
          }
          ctx.putImageData(imageData, 0, 0);
          return source;
        }
        drawStyledTile(tx, ty, style, dx, dy, ctx) {
          var color, source;
          if (!(source = this.prestyled[style])) {
            source = (color = TEAM_COLORS[style]) ? this.prestyled[style] = this.createPrestyled(color) : this.images.styled;
          }
          return (ctx || this.ctx).drawImage(source, tx * TILE_SIZE_PIXELS, ty * TILE_SIZE_PIXELS, TILE_SIZE_PIXELS, TILE_SIZE_PIXELS, dx, dy, TILE_SIZE_PIXELS, TILE_SIZE_PIXELS);
        }
        centerOn(x, y, cb) {
          var height, left, top, width;
          this.ctx.save();
          [left, top, width, height] = this.getViewAreaAtWorld(x, y);
          this.ctx.translate(-left, -top);
          cb(left, top, width, height);
          return this.ctx.restore();
        }
        drawBuilderIndicator(b) {
          var dist, offset, player, px, py, rad, x, y;
          player = b.owner.$;
          if ((dist = distance(player, b)) <= 128) {
            return;
          }
          px = player.x / PIXEL_SIZE_WORLD;
          py = player.y / PIXEL_SIZE_WORLD;
          this.ctx.save();
          this.ctx.globalCompositeOperation = "source-over";
          this.ctx.globalAlpha = min(1, (dist - 128) / 1024);
          offset = min(50, dist / 10240 * 50) + 32;
          rad = heading(player, b);
          this.ctx.beginPath();
          this.ctx.moveTo(x = px + cos(rad) * offset, y = py + sin(rad) * offset);
          rad += PI;
          this.ctx.lineTo(x + cos(rad - 0.4) * 10, y + sin(rad - 0.4) * 10);
          this.ctx.lineTo(x + cos(rad + 0.4) * 10, y + sin(rad + 0.4) * 10);
          this.ctx.closePath();
          this.ctx.fillStyle = "yellow";
          this.ctx.fill();
          return this.ctx.restore();
        }
        drawNames() {
          var dist, j, len, metrics, player, ref, tank, x, y;
          this.ctx.save();
          this.ctx.strokeStyle = this.ctx.fillStyle = "white";
          this.ctx.font = "bold 11px sans-serif";
          this.ctx.textBaselines = "alphabetic";
          this.ctx.textAlign = "left";
          player = this.world.player;
          ref = this.world.tanks;
          for (j = 0, len = ref.length; j < len; j++) {
            tank = ref[j];
            if (!(tank.name && tank.armour !== 255 && tank !== player)) {
              continue;
            }
            if (player) {
              if ((dist = distance(player, tank)) <= 768) {
                continue;
              }
              this.ctx.globalAlpha = min(1, (dist - 768) / 1536);
            } else {
              this.ctx.globalAlpha = 1;
            }
            metrics = this.ctx.measureText(tank.name);
            this.ctx.beginPath();
            this.ctx.moveTo(x = round(tank.x / PIXEL_SIZE_WORLD) + 16, y = round(tank.y / PIXEL_SIZE_WORLD) - 16);
            this.ctx.lineTo(x += 12, y -= 9);
            this.ctx.lineTo(x + metrics.width, y);
            this.ctx.stroke();
            this.ctx.fillText(tank.name, x, y - 2);
          }
          return this.ctx.restore();
        }
      };
      module.exports = Common2dRenderer;
    }
  });

  // compiled/src/client/renderer/offscreen_2d.js
  var require_offscreen_2d = __commonJS({
    "compiled/src/client/renderer/offscreen_2d.js"(exports, module) {
      var CachedSegment;
      var Common2dRenderer;
      var MAP_SIZE_SEGMENTS;
      var MAP_SIZE_TILES;
      var Offscreen2dRenderer;
      var SEGMENT_SIZE_PIXEL;
      var SEGMENT_SIZE_TILES;
      var TILE_SIZE_PIXELS;
      var floor;
      ({ floor } = Math);
      ({ TILE_SIZE_PIXELS, MAP_SIZE_TILES } = require_constants());
      Common2dRenderer = require_common_2d();
      SEGMENT_SIZE_TILES = 16;
      MAP_SIZE_SEGMENTS = MAP_SIZE_TILES / SEGMENT_SIZE_TILES;
      SEGMENT_SIZE_PIXEL = SEGMENT_SIZE_TILES * TILE_SIZE_PIXELS;
      CachedSegment = class CachedSegment {
        constructor(renderer, x, y) {
          this.renderer = renderer;
          this.sx = x * SEGMENT_SIZE_TILES;
          this.sy = y * SEGMENT_SIZE_TILES;
          this.ex = this.sx + SEGMENT_SIZE_TILES - 1;
          this.ey = this.sy + SEGMENT_SIZE_TILES - 1;
          this.psx = x * SEGMENT_SIZE_PIXEL;
          this.psy = y * SEGMENT_SIZE_PIXEL;
          this.pex = this.psx + SEGMENT_SIZE_PIXEL - 1;
          this.pey = this.psy + SEGMENT_SIZE_PIXEL - 1;
          this.canvas = null;
        }
        isInView(sx, sy, ex, ey) {
          if (ex < this.psx || ey < this.psy) {
            return false;
          } else if (sx > this.pex || sy > this.pey) {
            return false;
          } else {
            return true;
          }
        }
        build() {
          this.canvas = $("<canvas/>")[0];
          this.canvas.width = this.canvas.height = SEGMENT_SIZE_PIXEL;
          this.ctx = this.canvas.getContext("2d");
          this.ctx.translate(-this.psx, -this.psy);
          return this.renderer.world.map.each((cell) => {
            return this.onRetile(cell, cell.tile[0], cell.tile[1]);
          }, this.sx, this.sy, this.ex, this.ey);
        }
        clear() {
          return this.canvas = this.ctx = null;
        }
        onRetile(cell, tx, ty) {
          var obj, ref;
          if (!this.canvas) {
            return;
          }
          if (obj = cell.pill || cell.base) {
            return this.renderer.drawStyledTile(cell.tile[0], cell.tile[1], (ref = obj.owner) != null ? ref.$.team : void 0, cell.x * TILE_SIZE_PIXELS, cell.y * TILE_SIZE_PIXELS, this.ctx);
          } else {
            return this.renderer.drawTile(cell.tile[0], cell.tile[1], cell.x * TILE_SIZE_PIXELS, cell.y * TILE_SIZE_PIXELS, this.ctx);
          }
        }
      };
      Offscreen2dRenderer = class Offscreen2dRenderer extends Common2dRenderer {
        setup() {
          var i, ref, results, row, x, y;
          super.setup(...arguments);
          this.cache = new Array(MAP_SIZE_SEGMENTS);
          results = [];
          for (y = i = 0, ref = MAP_SIZE_SEGMENTS; 0 <= ref ? i < ref : i > ref; y = 0 <= ref ? ++i : --i) {
            row = this.cache[y] = new Array(MAP_SIZE_SEGMENTS);
            results.push((function() {
              var j, ref1, results1;
              results1 = [];
              for (x = j = 0, ref1 = MAP_SIZE_SEGMENTS; 0 <= ref1 ? j < ref1 : j > ref1; x = 0 <= ref1 ? ++j : --j) {
                results1.push(row[x] = new CachedSegment(this, x, y));
              }
              return results1;
            }).call(this));
          }
          return results;
        }
        // When a cell is retiled, we store the tile index and update the segment.
        onRetile(cell, tx, ty) {
          var segx, segy;
          cell.tile = [tx, ty];
          segx = floor(cell.x / SEGMENT_SIZE_TILES);
          segy = floor(cell.y / SEGMENT_SIZE_TILES);
          return this.cache[segy][segx].onRetile(cell, tx, ty);
        }
        // Drawing the map is a matter of iterating the map segments that are on-screen, and blitting
        // the off-screen canvas to the main canvas. The segments are prepared on-demand from here, and
        // extra care is taken to only build one segment per frame.
        drawMap(sx, sy, w, h) {
          var alreadyBuiltOne, ex, ey, i, j, len, len1, ref, row, segment;
          ex = sx + w - 1;
          ey = sy + h - 1;
          alreadyBuiltOne = false;
          ref = this.cache;
          for (i = 0, len = ref.length; i < len; i++) {
            row = ref[i];
            for (j = 0, len1 = row.length; j < len1; j++) {
              segment = row[j];
              if (!segment.isInView(sx, sy, ex, ey)) {
                if (segment.canvas) {
                  segment.clear();
                }
                continue;
              }
              if (!segment.canvas) {
                if (alreadyBuiltOne) {
                  continue;
                }
                segment.build();
                alreadyBuiltOne = true;
              }
              this.ctx.drawImage(segment.canvas, 0, 0, SEGMENT_SIZE_PIXEL, SEGMENT_SIZE_PIXEL, segment.psx, segment.psy, SEGMENT_SIZE_PIXEL, SEGMENT_SIZE_PIXEL);
            }
          }
        }
      };
      module.exports = Offscreen2dRenderer;
    }
  });

  // compiled/src/world_mixin.js
  var require_world_mixin = __commonJS({
    "compiled/src/world_mixin.js"(exports, module) {
      var BoloWorldMixin;
      BoloWorldMixin = {
        //### Player management
        // If only we could extend constructors using mixins.
        boloInit: function() {
          return this.tanks = [];
        },
        addTank: function(tank) {
          tank.tank_idx = this.tanks.length;
          this.tanks.push(tank);
          if (this.authority) {
            return this.resolveMapObjectOwners();
          }
        },
        removeTank: function(tank) {
          var i, j, ref, ref1;
          this.tanks.splice(tank.tank_idx, 1);
          for (i = j = ref = tank.tank_idx, ref1 = this.tanks.length; ref <= ref1 ? j < ref1 : j > ref1; i = ref <= ref1 ? ++j : --j) {
            this.tanks[i].tank_idx = i;
          }
          if (this.authority) {
            return this.resolveMapObjectOwners();
          }
        },
        //### Map helpers
        // A helper method which returns all map objects.
        getAllMapObjects: function() {
          return this.map.pills.concat(this.map.bases);
        },
        // The special spawning logic for MapObjects. These are created when the map is loaded, which is
        // before the World is created. We emulate `spawn` here for these objects.
        spawnMapObjects: function() {
          var j, len, obj, ref;
          ref = this.getAllMapObjects();
          for (j = 0, len = ref.length; j < len; j++) {
            obj = ref[j];
            obj.world = this;
            this.insert(obj);
            obj.spawn();
            obj.anySpawn();
          }
        },
        // Resolve pillbox and base owner indices to the actual tanks. This method is only really useful
        // on the server. Because of the way serialization works, the client doesn't get the see invalid
        // owner indices. (As can be seen in `ServerWorld#serialize`.) It is called whenever a player
        // joins or leaves the game.
        resolveMapObjectOwners: function() {
          var j, len, obj, ref, ref1;
          ref = this.getAllMapObjects();
          for (j = 0, len = ref.length; j < len; j++) {
            obj = ref[j];
            obj.ref("owner", this.tanks[obj.owner_idx]);
            if ((ref1 = obj.cell) != null) {
              ref1.retile();
            }
          }
        }
      };
      module.exports = BoloWorldMixin;
    }
  });

  // compiled/src/client/world/mixin.js
  var require_mixin = __commonJS({
    "compiled/src/client/world/mixin.js"(exports, module) {
      var BoloClientWorldMixin;
      var BoloWorldMixin;
      var DefaultRenderer;
      var Progress;
      var SoundKit;
      var TICK_LENGTH_MS;
      var Vignette;
      var createLoop;
      var helpers;
      ({ createLoop } = require_loop());
      Progress = require_progress();
      Vignette = require_vignette();
      SoundKit = require_soundkit();
      DefaultRenderer = require_offscreen_2d();
      ({ TICK_LENGTH_MS } = require_constants());
      helpers = require_helpers();
      BoloWorldMixin = require_world_mixin();
      BoloClientWorldMixin = {
        start: function() {
          var vignette;
          vignette = new Vignette();
          return this.waitForCache(vignette, () => {
            return this.loadResources(vignette, () => {
              return this.loaded(vignette);
            });
          });
        },
        // Wait for the applicationCache to finish downloading.
        waitForCache: function(vignette, callback) {
          var afterCache, cache;
          return callback();
          vignette.message("Checking for newer versions");
          cache = $(applicationCache);
          cache.bind("downloading.bolo", function() {
            vignette.message("Downloading latest version");
            vignette.showProgress();
            return cache.bind("progress.bolo", function(p) {
              return vignette.progress(p);
            });
          });
          cache.bind("updateready.bolo", function() {
            vignette.hideProgress();
            vignette.message("Reloading latest version");
            return location.reload();
          });
          afterCache = function() {
            vignette.hideProgress();
            cache.unbind(".bolo");
            return callback();
          };
          cache.bind("cached.bolo", afterCache);
          return cache.bind("noupdate.bolo", afterCache);
        },
        // Loads all required resources.
        loadResources: function(vignette, callback) {
          var progress;
          vignette.message("Loading resources");
          progress = new Progress();
          this.images = {};
          this.loadImages((name) => {
            var img;
            this.images[name] = img = new Image();
            $(img).on("load", progress.add());
            return img.src = `images/${name}.png`;
          });
          this.soundkit = new SoundKit();
          this.loadSounds((name) => {
            var i, j, methodName, parts, ref, src;
            src = `sounds/${name}.ogg`;
            parts = name.split("_");
            for (i = j = 1, ref = parts.length; 1 <= ref ? j < ref : j > ref; i = 1 <= ref ? ++j : --j) {
              parts[i] = parts[i].substr(0, 1).toUpperCase() + parts[i].substr(1);
            }
            methodName = parts.join("");
            return this.soundkit.load(methodName, src, progress.add());
          });
          if (typeof applicationCache === "undefined" || applicationCache === null) {
            vignette.showProgress();
            progress.on("progress", function(p) {
              return vignette.progress(p);
            });
          }
          progress.on("complete", function() {
            vignette.hideProgress();
            return callback();
          });
          return progress.wrapUp();
        },
        loadImages: function(i) {
          i("base");
          i("styled");
          return i("overlay");
        },
        loadSounds: function(s) {
          s("big_explosion_far");
          s("big_explosion_near");
          s("bubbles");
          s("farming_tree_far");
          s("farming_tree_near");
          s("hit_tank_far");
          s("hit_tank_near");
          s("hit_tank_self");
          s("man_building_far");
          s("man_building_near");
          s("man_dying_far");
          s("man_dying_near");
          s("man_lay_mine_near");
          s("mine_explosion_far");
          s("mine_explosion_near");
          s("shooting_far");
          s("shooting_near");
          s("shooting_self");
          s("shot_building_far");
          s("shot_building_near");
          s("shot_tree_far");
          s("shot_tree_near");
          s("tank_sinking_far");
          return s("tank_sinking_near");
        },
        // Common initialization once the map is available.
        commonInitialization: function() {
          this.renderer = new DefaultRenderer(this);
          this.map.world = this;
          this.map.setView(this.renderer);
          this.boloInit();
          this.loop = createLoop({
            rate: TICK_LENGTH_MS,
            tick: () => {
              return this.tick();
            },
            frame: () => {
              return this.renderer.draw();
            }
          });
          this.increasingRange = false;
          this.decreasingRange = false;
          this.rangeAdjustTimer = 0;
          this.input = $("<input/>", {
            id: "input-dummy",
            type: "text"
          }).attr("autocomplete", "off");
          this.input.insertBefore(this.renderer.canvas).focus();
          return this.input.add(this.renderer.canvas).add("#tool-select label").keydown((e) => {
            e.preventDefault();
            switch (e.which) {
              case 90:
                return this.increasingRange = true;
              case 88:
                return this.decreasingRange = true;
              default:
                return this.handleKeydown(e);
            }
          }).keyup((e) => {
            e.preventDefault();
            switch (e.which) {
              case 90:
                return this.increasingRange = false;
              case 88:
                return this.decreasingRange = false;
              default:
                return this.handleKeyup(e);
            }
          });
        },
        // Method called when things go awry.
        failure: function(message) {
          var ref;
          if ((ref = this.loop) != null) {
            ref.stop();
          }
          return $("<div/>").text(message).dialog({
            modal: true,
            dialogClass: "unclosable"
          });
        },
        // Check and rewrite the build order that the user just tried to do.
        checkBuildOrder: function(action, cell) {
          var builder, flexible, pills, trees;
          builder = this.player.builder.$;
          if (builder.order !== builder.states.inTank) {
            return [false];
          }
          if (cell.mine) {
            return [false];
          }
          [action, trees, flexible] = (function() {
            switch (action) {
              case "forest":
                if (cell.base || cell.pill || !cell.isType("#")) {
                  return [false];
                } else {
                  return ["forest", 0];
                }
                break;
              case "road":
                if (cell.base || cell.pill || cell.isType("|", "}", "b", "^")) {
                  return [false];
                } else if (cell.isType("#")) {
                  return ["forest", 0];
                } else if (cell.isType("=")) {
                  return [false];
                } else if (cell.isType(" ") && cell.hasTankOnBoat()) {
                  return [false];
                } else {
                  return ["road", 2];
                }
                break;
              case "building":
                if (cell.base || cell.pill || cell.isType("b", "^")) {
                  return [false];
                } else if (cell.isType("#")) {
                  return ["forest", 0];
                } else if (cell.isType("}")) {
                  return ["repair", 1];
                } else if (cell.isType("|")) {
                  return [false];
                } else if (cell.isType(" ")) {
                  if (cell.hasTankOnBoat()) {
                    return [false];
                  } else {
                    return ["boat", 20];
                  }
                } else if (cell === this.player.cell) {
                  return [false];
                } else {
                  return ["building", 2];
                }
                break;
              case "pillbox":
                if (cell.pill) {
                  if (cell.pill.armour === 16) {
                    return [false];
                  } else if (cell.pill.armour >= 11) {
                    return ["repair", 1, true];
                  } else if (cell.pill.armour >= 7) {
                    return ["repair", 2, true];
                  } else if (cell.pill.armour >= 3) {
                    return ["repair", 3, true];
                  } else if (cell.pill.armour < 3) {
                    return ["repair", 4, true];
                  }
                } else if (cell.isType("#")) {
                  return ["forest", 0];
                } else if (cell.base || cell.isType("b", "^", "|", "}", " ")) {
                  return [false];
                } else if (cell === this.player.cell) {
                  return [false];
                } else {
                  return ["pillbox", 4];
                }
                break;
              case "mine":
                if (cell.base || cell.pill || cell.isType("^", " ", "|", "b", "}")) {
                  return [false];
                } else {
                  return ["mine"];
                }
            }
          }).call(this);
          if (!action) {
            return [false];
          }
          if (action === "mine") {
            if (this.player.mines === 0) {
              return [false];
            }
            return ["mine"];
          }
          if (action === "pill") {
            pills = this.player.getCarryingPillboxes();
            if (pills.length === 0) {
              return [false];
            }
          }
          if (this.player.trees < trees) {
            if (!flexible) {
              return [false];
            }
            trees = this.player.trees;
          }
          return [action, trees, flexible];
        }
      };
      helpers.extend(BoloClientWorldMixin, BoloWorldMixin);
      module.exports = BoloClientWorldMixin;
    }
  });

  // compiled/src/client/world/local.js
  var require_local2 = __commonJS({
    "compiled/src/client/world/local.js"(exports, module) {
      var BoloLocalWorld;
      var EverardIsland;
      var NetLocalWorld;
      var Tank;
      var WorldMap;
      var allObjects;
      var decodeBase64;
      var helpers;
      NetLocalWorld = require_local();
      WorldMap = require_world_map();
      EverardIsland = require_everard();
      allObjects = require_all();
      Tank = require_tank();
      ({ decodeBase64 } = require_base64());
      helpers = require_helpers();
      BoloLocalWorld = (function() {
        class BoloLocalWorld2 extends NetLocalWorld {
          // Callback after resources have been loaded.
          loaded(vignette) {
            this.map = WorldMap.load(decodeBase64(EverardIsland));
            this.commonInitialization();
            this.spawnMapObjects();
            this.player = this.spawn(Tank, 0);
            this.renderer.initHud();
            vignette.destroy();
            return this.loop.start();
          }
          tick() {
            super.tick(...arguments);
            if (this.increasingRange !== this.decreasingRange) {
              if (++this.rangeAdjustTimer === 6) {
                if (this.increasingRange) {
                  this.player.increaseRange();
                } else {
                  this.player.decreaseRange();
                }
                return this.rangeAdjustTimer = 0;
              }
            } else {
              return this.rangeAdjustTimer = 0;
            }
          }
          soundEffect(sfx, x, y, owner) {
            return this.renderer.playSound(sfx, x, y, owner);
          }
          mapChanged(cell, oldType, hadMine, oldLife) {
          }
          //### Input handlers.
          handleKeydown(e) {
            switch (e.which) {
              case 32:
                return this.player.shooting = true;
              case 37:
                return this.player.turningCounterClockwise = true;
              case 38:
                return this.player.accelerating = true;
              case 39:
                return this.player.turningClockwise = true;
              case 40:
                return this.player.braking = true;
            }
          }
          handleKeyup(e) {
            switch (e.which) {
              case 32:
                return this.player.shooting = false;
              case 37:
                return this.player.turningCounterClockwise = false;
              case 38:
                return this.player.accelerating = false;
              case 39:
                return this.player.turningClockwise = false;
              case 40:
                return this.player.braking = false;
            }
          }
          buildOrder(action, trees, cell) {
            return this.player.builder.$.performOrder(action, trees, cell);
          }
        }
        ;
        BoloLocalWorld2.prototype.authority = true;
        return BoloLocalWorld2;
      }).call(exports);
      helpers.extend(BoloLocalWorld.prototype, require_mixin());
      allObjects.registerWithWorld(BoloLocalWorld.prototype);
      module.exports = BoloLocalWorld;
    }
  });

  // compiled/node_modules/villain/struct.js
  var require_struct = __commonJS({
    "compiled/node_modules/villain/struct.js"(exports) {
      var buildPacker;
      var buildUnpacker;
      var fromUint16;
      var fromUint32;
      var fromUint8;
      var pack;
      var toUint16;
      var toUint32;
      var toUint8;
      var unpack;
      toUint8 = function(n) {
        return [n & 255];
      };
      toUint16 = function(n) {
        return [(n & 65280) >> 8, n & 255];
      };
      toUint32 = function(n) {
        return [(n & 4278190080) >> 24, (n & 16711680) >> 16, (n & 65280) >> 8, n & 255];
      };
      fromUint8 = function(d, o) {
        return d[o];
      };
      fromUint16 = function(d, o) {
        return (d[o] << 8) + d[o + 1];
      };
      fromUint32 = function(d, o) {
        return (d[o] << 24) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
      };
      buildPacker = function() {
        var bitIndex, bits, data, flushBitFields, retval;
        data = [];
        bits = null;
        bitIndex = 0;
        flushBitFields = function() {
          if (bits === null) {
            return;
          }
          data.push(bits);
          return bits = null;
        };
        retval = function(type, value) {
          if (type === "f") {
            if (bits === null) {
              bits = !!value ? 1 : 0;
              return bitIndex = 1;
            } else {
              if (!!value) {
                bits |= 1 << bitIndex;
              }
              bitIndex++;
              if (bitIndex === 8) {
                return flushBitFields();
              }
            }
          } else {
            flushBitFields();
            return data = data.concat((function() {
              switch (type) {
                case "B":
                  return toUint8(value);
                case "H":
                  return toUint16(value);
                case "I":
                  return toUint32(value);
                default:
                  throw new Error(`Unknown format character ${type}`);
              }
            })());
          }
        };
        retval.finish = function() {
          flushBitFields();
          return data;
        };
        return retval;
      };
      buildUnpacker = function(data, offset) {
        var bitIndex, idx, retval;
        offset || (offset = 0);
        idx = offset;
        bitIndex = 0;
        retval = function(type) {
          var bit, bytes, value;
          if (type === "f") {
            bit = 1 << bitIndex & data[idx];
            value = bit > 0;
            bitIndex++;
            if (bitIndex === 8) {
              idx++;
              bitIndex = 0;
            }
          } else {
            if (bitIndex !== 0) {
              idx++;
              bitIndex = 0;
            }
            [value, bytes] = (function() {
              switch (type) {
                case "B":
                  return [fromUint8(data, idx), 1];
                case "H":
                  return [fromUint16(data, idx), 2];
                case "I":
                  return [fromUint32(data, idx), 4];
                default:
                  throw new Error(`Unknown format character ${type}`);
              }
            })();
            idx += bytes;
          }
          return value;
        };
        retval.finish = function() {
          if (bitIndex !== 0) {
            idx++;
          }
          return idx - offset;
        };
        return retval;
      };
      pack = function(fmt) {
        var i, j, len, packer, type, value;
        packer = buildPacker();
        for (i = j = 0, len = fmt.length; j < len; i = ++j) {
          type = fmt[i];
          value = arguments[i + 1];
          packer(type, value);
        }
        return packer.finish();
      };
      unpack = function(fmt, data, offset) {
        var type, unpacker, values;
        unpacker = buildUnpacker(data, offset);
        values = (function() {
          var j, len, results;
          results = [];
          for (j = 0, len = fmt.length; j < len; j++) {
            type = fmt[j];
            results.push(unpacker(type));
          }
          return results;
        })();
        return [values, unpacker.finish()];
      };
      exports.buildPacker = buildPacker;
      exports.buildUnpacker = buildUnpacker;
      exports.pack = pack;
      exports.unpack = unpack;
    }
  });

  // compiled/node_modules/villain/world/net/client.js
  var require_client = __commonJS({
    "compiled/node_modules/villain/world/net/client.js"(exports, module) {
      var BaseWorld;
      var ClientWorld;
      var buildUnpacker;
      var unpack;
      BaseWorld = require_base();
      ({ unpack, buildUnpacker } = require_struct());
      ClientWorld = class ClientWorld extends BaseWorld {
        // The client receives character code identifiers for object types. In order to find the object
        // type belonging to a code, a registry is needed.
        registerType(type) {
          if (!this.hasOwnProperty("types")) {
            this.types = [];
          }
          return this.types.push(type);
        }
        // The following are implementations of abstract `BaseWorld` methods for the client. Any
        // world simulation done on the client is only to make the game appear smooth at low latencies
        // or network interruptions. The client thus has to keep track of changes it makes, so that it
        // can always return to a state where it is synchronized with the server.
        constructor() {
          super(...arguments);
          this.changes = [];
        }
        spawn(type, ...args) {
          var obj;
          obj = this.insert(new type(this));
          this.changes.unshift(["create", obj.idx, obj]);
          obj._net_transient = true;
          obj.spawn(...args);
          obj.anySpawn();
          return obj;
        }
        update(obj) {
          obj.update();
          obj.emit("update");
          obj.emit("anyUpdate");
          return obj;
        }
        destroy(obj) {
          this.changes.unshift(["destroy", obj.idx, obj]);
          this.remove(obj);
          obj.emit("destroy");
          if (obj._net_transient) {
            obj.emit("finalize");
          }
          return obj;
        }
        //### Object synchronization
        // These methods are responsible for performing the synchronization based on messages received
        // from the server. When processing messages, networking calls the `netSpawn`, `netTick` and
        // `netDestroy` methods. Each of these take the raw message data, process it, then return the
        // number of bytes they used.
        // Before newly received messages are processed, `netRestore()` is called. This method takes care
        // of reverting any local changes that were made on the client.
        netRestore() {
          var i, idx, j, k, len, len1, obj, ref, ref1, type;
          if (!(this.changes.length > 0)) {
            return;
          }
          ref = this.changes;
          for (j = 0, len = ref.length; j < len; j++) {
            [type, idx, obj] = ref[j];
            switch (type) {
              case "create":
                if (obj.transient && !obj._net_revived) {
                  obj.emit("finalize");
                }
                this.objects.splice(idx, 1);
                break;
              case "destroy":
                obj._net_revived = true;
                this.objects.splice(idx, 0, obj);
            }
          }
          this.changes = [];
          ref1 = this.objects;
          for (i = k = 0, len1 = ref1.length; k < len1; i = ++k) {
            obj = ref1[i];
            obj.idx = i;
          }
        }
        // Networking code adds objects to the network using `netSpawn`. This method creates the object,
        // but leaves it bare-bones otherwise. State for the new object is received in the upcoming
        // update message, at which point events are emitted.
        netSpawn(data, offset) {
          var obj, type;
          type = this.types[data[offset]];
          obj = this.insert(new type(this));
          obj._net_transient = false;
          obj._net_new = true;
          return 1;
        }
        // The `netUpdate` method asks a single object to deserialize state from the given data, and emits
        // the proper events. This is called in a loop from `netTick`, which is what you usually want to
        // call instead.
        netUpdate(obj, data, offset) {
          var bytes, changes;
          [bytes, changes] = this.deserialize(obj, data, offset, obj._net_new);
          if (obj._net_new) {
            obj.netSpawn();
            obj.anySpawn();
            obj._net_new = false;
          } else {
            obj.emit("netUpdate", changes);
            obj.emit("anyUpdate");
          }
          obj.emit("netSync");
          return bytes;
        }
        // Networking code can remove objects from the world with the `netDestroy` method.
        netDestroy(data, offset) {
          var bytes, obj, obj_idx;
          [[obj_idx], bytes] = unpack("H", data, offset);
          obj = this.objects[obj_idx];
          if (!obj._net_new) {
            obj.emit("netDestroy");
            obj.emit("anyDestroy");
            obj.emit("finalize");
          }
          this.remove(obj);
          return bytes;
        }
        // A complete update of state for all objects is passed to `netTick`. It is assumed at this point
        // that the object list on the server and client are the same. Thus, this method expects a stream
        // of serialized object state, which it walks through, calling `netUpdate` for each object and
        // the relevant chunk of data from the stream.
        netTick(data, offset) {
          var bytes, j, len, obj, ref;
          bytes = 0;
          ref = this.objects;
          for (j = 0, len = ref.length; j < len; j++) {
            obj = ref[j];
            bytes += this.netUpdate(obj, data, offset + bytes);
          }
          return bytes;
        }
        // The `deserialize` helper builds the generator used for deserialization and passes it to the
        // `serialization` method of `object`. It wraps `struct.unpacker` with the function signature
        // that we want, and also adds the necessary support to process the `O` format specifier.
        deserialize(obj, data, offset, isCreate) {
          var changes, unpacker;
          unpacker = buildUnpacker(data, offset);
          changes = {};
          obj.serialization(isCreate, (specifier, attribute, options) => {
            var oldValue, other, ref, value;
            options || (options = {});
            if (specifier === "O") {
              other = this.objects[unpacker("H")];
              if ((oldValue = (ref = obj[attribute]) != null ? ref.$ : void 0) !== other) {
                changes[attribute] = oldValue;
                obj.ref(attribute, other);
              }
            } else {
              value = unpacker(specifier);
              if (options.rx != null) {
                value = options.rx(value);
              }
              if ((oldValue = obj[attribute]) !== value) {
                changes[attribute] = oldValue;
                obj[attribute] = value;
              }
            }
          });
          return [unpacker.finish(), changes];
        }
      };
      module.exports = ClientWorld;
    }
  });

  // compiled/src/struct.js
  var require_struct2 = __commonJS({
    "compiled/src/struct.js"(exports) {
      var buildPacker;
      var buildUnpacker;
      var fromUint16;
      var fromUint32;
      var fromUint8;
      var pack;
      var toUint16;
      var toUint32;
      var toUint8;
      var unpack;
      toUint8 = function(n) {
        return [n & 255];
      };
      toUint16 = function(n) {
        return [(n & 65280) >> 8, n & 255];
      };
      toUint32 = function(n) {
        return [(n & 4278190080) >> 24, (n & 16711680) >> 16, (n & 65280) >> 8, n & 255];
      };
      fromUint8 = function(d, o) {
        return d[o];
      };
      fromUint16 = function(d, o) {
        return (d[o] << 8) + d[o + 1];
      };
      fromUint32 = function(d, o) {
        return (d[o] << 24) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
      };
      buildPacker = function() {
        var bitIndex, bits, data, flushBitFields, retval;
        data = [];
        bits = null;
        bitIndex = 0;
        flushBitFields = function() {
          if (bits === null) {
            return;
          }
          data.push(bits);
          return bits = null;
        };
        retval = function(type, value) {
          if (type === "f") {
            if (bits === null) {
              bits = !!value ? 1 : 0;
              return bitIndex = 1;
            } else {
              if (!!value) {
                bits |= 1 << bitIndex;
              }
              bitIndex++;
              if (bitIndex === 8) {
                return flushBitFields();
              }
            }
          } else {
            flushBitFields();
            return data = data.concat((function() {
              switch (type) {
                case "B":
                  return toUint8(value);
                case "H":
                  return toUint16(value);
                case "I":
                  return toUint32(value);
                default:
                  throw new Error(`Unknown format character ${type}`);
              }
            })());
          }
        };
        retval.finish = function() {
          flushBitFields();
          return data;
        };
        return retval;
      };
      buildUnpacker = function(data, offset) {
        var bitIndex, idx, retval;
        offset || (offset = 0);
        idx = offset;
        bitIndex = 0;
        retval = function(type) {
          var bit, bytes, value;
          if (type === "f") {
            bit = 1 << bitIndex & data[idx];
            value = bit > 0;
            bitIndex++;
            if (bitIndex === 8) {
              idx++;
              bitIndex = 0;
            }
          } else {
            if (bitIndex !== 0) {
              idx++;
              bitIndex = 0;
            }
            [value, bytes] = (function() {
              switch (type) {
                case "B":
                  return [fromUint8(data, idx), 1];
                case "H":
                  return [fromUint16(data, idx), 2];
                case "I":
                  return [fromUint32(data, idx), 4];
                default:
                  throw new Error(`Unknown format character ${type}`);
              }
            })();
            idx += bytes;
          }
          return value;
        };
        retval.finish = function() {
          if (bitIndex !== 0) {
            idx++;
          }
          return idx - offset;
        };
        return retval;
      };
      pack = function(fmt) {
        var i, j, len, packer, type, value;
        packer = buildPacker();
        for (i = j = 0, len = fmt.length; j < len; i = ++j) {
          type = fmt[i];
          value = arguments[i + 1];
          packer(type, value);
        }
        return packer.finish();
      };
      unpack = function(fmt, data, offset) {
        var type, unpacker, values;
        unpacker = buildUnpacker(data, offset);
        values = (function() {
          var j, len, results;
          results = [];
          for (j = 0, len = fmt.length; j < len; j++) {
            type = fmt[j];
            results.push(unpacker(type));
          }
          return results;
        })();
        return [values, unpacker.finish()];
      };
      exports.buildPacker = buildPacker;
      exports.buildUnpacker = buildUnpacker;
      exports.pack = pack;
      exports.unpack = unpack;
    }
  });

  // compiled/src/client/world/client.js
  var require_client2 = __commonJS({
    "compiled/src/client/world/client.js"(exports, module) {
      var BoloClientWorld;
      var ClientWorld;
      var JOIN_DIALOG_TEMPLATE;
      var WorldBase;
      var WorldMap;
      var WorldPillbox;
      var allObjects;
      var decodeBase64;
      var helpers;
      var net;
      var unpack;
      ClientWorld = require_client();
      WorldMap = require_world_map();
      allObjects = require_all();
      WorldPillbox = require_world_pillbox();
      WorldBase = require_world_base();
      ({ unpack } = require_struct2());
      ({ decodeBase64 } = require_base64());
      net = require_net();
      helpers = require_helpers();
      JOIN_DIALOG_TEMPLATE = `<div id="join-dialog">
  <div>
    <p>What is your name?</p>
    <p><input type="text" id="join-nick-field" name="join-nick-field" maxlength=20></input></p>
  </div>
  <div id="join-team">
    <p>Choose a side:</p>
    <p>
      <input type="radio" id="join-team-red" name="join-team" value="red"></input>
      <label for="join-team-red"><span class="bolo-team bolo-team-red"></span></label>
      <input type="radio" id="join-team-blue" name="join-team" value="blue"></input>
      <label for="join-team-blue"><span class="bolo-team bolo-team-blue"></span></label>
    </p>
  </div>
  <div>
    <p><input type="button" name="join-submit" id="join-submit" value="Join game"></input></p>
  </div>
</div>`;
      BoloClientWorld = (function() {
        class BoloClientWorld2 extends ClientWorld {
          constructor() {
            super(...arguments);
            this.mapChanges = {};
            this.processingServerMessages = false;
          }
          // Callback after resources have been loaded.
          loaded(vignette) {
            var m, path, url, ws;
            this.vignette = vignette;
            this.vignette.message("Connecting to the multiplayer game");
            this.heartbeatTimer = 0;
            // grown integration: play.html (online mode) sets a full ws(s):// URL
            // in window.__BOLO_WS_URL pointing at grown's reverse-proxied
            // /bolo-mp/match/<gid> endpoint (wss:// on HTTPS). When present we use
            // it verbatim; otherwise fall back to the original same-origin scheme
            // (?<gid> -> /match/<gid>, bare -> /demo) used by the standalone M1
            // server. This keeps the M1 smoke-test path working unchanged.
            if (typeof window !== "undefined" && window.__BOLO_WS_URL) {
              url = window.__BOLO_WS_URL;
            } else {
              if (m = /^\?([a-z]{20})$/.exec(location.search)) {
                path = `/match/${m[1]}`;
              } else if (location.search) {
                return this.vignette.message("Invalid game ID");
              } else {
                path = "/demo";
              }
              url = `ws://${location.host}${path}`;
            }
            this.ws = new WebSocket(url);
            ws = $(this.ws);
            ws.one("open.bolo", () => {
              return this.connected();
            });
            return ws.one("close.bolo", () => {
              return this.failure("Connection lost");
            });
          }
          connected() {
            var ws;
            this.vignette.message("Waiting for the game map");
            ws = $(this.ws);
            return ws.one("message.bolo", (e) => {
              return this.receiveMap(e.originalEvent);
            });
          }
          // Callback after the map was received.
          receiveMap(e) {
            this.map = WorldMap.load(decodeBase64(e.data));
            this.commonInitialization();
            this.vignette.message("Waiting for the game state");
            return $(this.ws).bind("message.bolo", (e2) => {
              return this.handleMessage(e2.originalEvent);
            });
          }
          // Callback after the server tells us we are synchronized.
          synchronized() {
            var blue, disadvantaged, i, len, red, ref, tank;
            this.rebuildMapObjects();
            this.vignette.destroy();
            this.vignette = null;
            this.loop.start();
            red = blue = 0;
            ref = this.tanks;
            for (i = 0, len = ref.length; i < len; i++) {
              tank = ref[i];
              if (tank.team === 0) {
                red++;
              }
              if (tank.team === 1) {
                blue++;
              }
            }
            disadvantaged = blue < red ? "blue" : "red";
            this.joinDialog = $(JOIN_DIALOG_TEMPLATE).dialog({
              dialogClass: "unclosable"
            });
            return this.joinDialog.find("#join-nick-field").val($.cookie("nick") || "").focus().keydown((e) => {
              if (e.which === 13) {
                return this.join();
              }
            }).end().find(`#join-team-${disadvantaged}`).attr("checked", "checked").end().find("#join-team").buttonset().end().find("#join-submit").button().click(() => {
              return this.join();
            });
          }
          join() {
            var nick, team;
            nick = this.joinDialog.find("#join-nick-field").val();
            team = this.joinDialog.find("#join-team input[checked]").val();
            team = (function() {
              switch (team) {
                case "red":
                  return 0;
                case "blue":
                  return 1;
                default:
                  return -1;
              }
            })();
            if (!(nick && team !== -1)) {
              return;
            }
            $.cookie("nick", nick);
            this.joinDialog.dialog("destroy");
            this.joinDialog = null;
            this.ws.send(JSON.stringify({
              command: "join",
              nick,
              team
            }));
            return this.input.focus();
          }
          // Callback after the welcome message was received.
          receiveWelcome(tank) {
            this.player = tank;
            this.renderer.initHud();
            return this.initChat();
          }
          // Send the heartbeat (an empty message) every 10 ticks / 400ms.
          tick() {
            super.tick(...arguments);
            if (this.increasingRange !== this.decreasingRange) {
              if (++this.rangeAdjustTimer === 6) {
                if (this.increasingRange) {
                  this.ws.send(net.INC_RANGE);
                } else {
                  this.ws.send(net.DEC_RANGE);
                }
                this.rangeAdjustTimer = 0;
              }
            } else {
              this.rangeAdjustTimer = 0;
            }
            if (++this.heartbeatTimer === 10) {
              this.heartbeatTimer = 0;
              return this.ws.send("");
            }
          }
          failure(message) {
            if (this.ws) {
              this.ws.close();
              $(this.ws).unbind(".bolo");
              this.ws = null;
            }
            return super.failure(...arguments);
          }
          // On the client, this is a no-op.
          soundEffect(sfx, x, y, owner) {
          }
          // Keep track of map changes that we made locally. We only remember the last state of a cell
          // that the server told us about, so we can restore it to that state before processing
          // server updates.
          mapChanged(cell, oldType, hadMine, oldLife) {
            if (this.processingServerMessages) {
              return;
            }
            if (this.mapChanges[cell.idx] == null) {
              cell._net_oldType = oldType;
              cell._net_hadMine = hadMine;
              cell._net_oldLife = oldLife;
              this.mapChanges[cell.idx] = cell;
            }
          }
          //### Chat handlers
          initChat() {
            this.chatMessages = $("<div/>", {
              id: "chat-messages"
            }).appendTo(this.renderer.hud);
            this.chatContainer = $("<div/>", {
              id: "chat-input"
            }).appendTo(this.renderer.hud).hide();
            return this.chatInput = $("<input/>", {
              type: "text",
              name: "chat",
              maxlength: 140
            }).appendTo(this.chatContainer).keydown((e) => {
              return this.handleChatKeydown(e);
            });
          }
          openChat(options) {
            options || (options = {});
            this.chatContainer.show();
            return this.chatInput.val("").focus().team = options.team;
          }
          commitChat() {
            this.ws.send(JSON.stringify({
              command: this.chatInput.team ? "teamMsg" : "msg",
              text: this.chatInput.val()
            }));
            return this.closeChat();
          }
          closeChat() {
            this.chatContainer.hide();
            return this.input.focus();
          }
          receiveChat(who, text, options) {
            var element;
            options || (options = {});
            element = options.team ? $("<p/>", {
              class: "msg-team"
            }).text(`<${who.name}> ${// FIXME: Style the name according to team, but the palette colors might not be readable.
            text}`) : $("<p/>", {
              class: "msg"
            }).text(`<${who.name}> ${text}`);
            this.chatMessages.append(element);
            return window.setTimeout(() => {
              return element.remove();
            }, 7e3);
          }
          //### Input handlers.
          handleKeydown(e) {
            if (!(this.ws && this.player)) {
              return;
            }
            switch (e.which) {
              case 32:
                return this.ws.send(net.START_SHOOTING);
              case 37:
                return this.ws.send(net.START_TURNING_CCW);
              case 38:
                return this.ws.send(net.START_ACCELERATING);
              case 39:
                return this.ws.send(net.START_TURNING_CW);
              case 40:
                return this.ws.send(net.START_BRAKING);
              case 84:
                return this.openChat();
              case 82:
                return this.openChat({
                  team: true
                });
            }
          }
          handleKeyup(e) {
            if (!(this.ws && this.player)) {
              return;
            }
            switch (e.which) {
              case 32:
                return this.ws.send(net.STOP_SHOOTING);
              case 37:
                return this.ws.send(net.STOP_TURNING_CCW);
              case 38:
                return this.ws.send(net.STOP_ACCELERATING);
              case 39:
                return this.ws.send(net.STOP_TURNING_CW);
              case 40:
                return this.ws.send(net.STOP_BRAKING);
            }
          }
          handleChatKeydown(e) {
            if (!(this.ws && this.player)) {
              return;
            }
            switch (e.which) {
              case 13:
                this.commitChat();
                break;
              case 27:
                this.closeChat();
                break;
              default:
                return;
            }
            return e.preventDefault();
          }
          buildOrder(action, trees, cell) {
            if (!(this.ws && this.player)) {
              return;
            }
            trees || (trees = 0);
            return this.ws.send([net.BUILD_ORDER, action, trees, cell.x, cell.y].join(","));
          }
          //### Network message handlers.
          handleMessage(e) {
            var ate, command, data, error, i, len, length, message, pos, ref;
            error = null;
            if (e.data.charAt(0) === "{") {
              try {
                this.handleJsonCommand(JSON.parse(e.data));
              } catch (error1) {
                e = error1;
                error = e;
              }
            } else if (e.data.charAt(0) === "[") {
              try {
                ref = JSON.parse(e.data);
                for (i = 0, len = ref.length; i < len; i++) {
                  message = ref[i];
                  this.handleJsonCommand(message);
                }
              } catch (error1) {
                e = error1;
                error = e;
              }
            } else {
              this.netRestore();
              try {
                data = decodeBase64(e.data);
                pos = 0;
                length = data.length;
                this.processingServerMessages = true;
                while (pos < length) {
                  command = data[pos++];
                  ate = this.handleBinaryCommand(command, data, pos);
                  pos += ate;
                }
                this.processingServerMessages = false;
                if (pos !== length) {
                  error = new Error(`Message length mismatch, processed ${pos} out of ${length} bytes`);
                }
              } catch (error1) {
                e = error1;
                error = e;
              }
            }
            if (error) {
              this.failure("Connection lost (protocol error)");
              if (typeof console !== "undefined" && console !== null) {
                console.log("Following exception occurred while processing message:", e.data);
              }
              throw error;
            }
          }
          handleBinaryCommand(command, data, offset) {
            var ascii, bytes, cell, code, idx, life, mine, owner, sfx, tank_idx, x, y;
            switch (command) {
              case net.SYNC_MESSAGE:
                this.synchronized();
                return 0;
              case net.WELCOME_MESSAGE:
                [[tank_idx], bytes] = unpack("H", data, offset);
                this.receiveWelcome(this.objects[tank_idx]);
                return bytes;
              case net.CREATE_MESSAGE:
                return this.netSpawn(data, offset);
              case net.DESTROY_MESSAGE:
                return this.netDestroy(data, offset);
              case net.MAPCHANGE_MESSAGE:
                [[x, y, code, life, mine], bytes] = unpack("BBBBf", data, offset);
                ascii = String.fromCharCode(code);
                cell = this.map.cells[y][x];
                cell.setType(ascii, mine);
                cell.life = life;
                return bytes;
              case net.SOUNDEFFECT_MESSAGE:
                [[sfx, x, y, owner], bytes] = unpack("BHHH", data, offset);
                this.renderer.playSound(sfx, x, y, this.objects[owner]);
                return bytes;
              case net.TINY_UPDATE_MESSAGE:
                [[idx], bytes] = unpack("H", data, offset);
                bytes += this.netUpdate(this.objects[idx], data, offset + bytes);
                return bytes;
              case net.UPDATE_MESSAGE:
                return this.netTick(data, offset);
              default:
                throw new Error(`Bad command '${command}' from server, at offset ${offset - 1}`);
            }
          }
          handleJsonCommand(data) {
            switch (data.command) {
              case "nick":
                return this.objects[data.idx].name = data.nick;
              case "msg":
                return this.receiveChat(this.objects[data.idx], data.text);
              case "teamMsg":
                return this.receiveChat(this.objects[data.idx], data.text, {
                  team: true
                });
              default:
                throw new Error(`Bad JSON command '${data.command}' from server.`);
            }
          }
          //### Helpers
          // Fill `@map.pills` and `@map.bases` based on the current object list.
          rebuildMapObjects() {
            var i, len, obj, ref, ref1;
            this.map.pills = [];
            this.map.bases = [];
            ref = this.objects;
            for (i = 0, len = ref.length; i < len; i++) {
              obj = ref[i];
              if (obj instanceof WorldPillbox) {
                this.map.pills.push(obj);
              } else if (obj instanceof WorldBase) {
                this.map.bases.push(obj);
              } else {
                continue;
              }
              if ((ref1 = obj.cell) != null) {
                ref1.retile();
              }
            }
          }
          // Override that reverts map changes as well.
          netRestore() {
            var cell, idx, ref;
            super.netRestore(...arguments);
            ref = this.mapChanges;
            for (idx in ref) {
              cell = ref[idx];
              cell.setType(cell._net_oldType, cell._net_hadMine);
              cell.life = cell._net_oldLife;
            }
            return this.mapChanges = {};
          }
        }
        ;
        BoloClientWorld2.prototype.authority = false;
        return BoloClientWorld2;
      }).call(exports);
      helpers.extend(BoloClientWorld.prototype, require_mixin());
      allObjects.registerWithWorld(BoloClientWorld.prototype);
      module.exports = BoloClientWorld;
    }
  });

  // compiled/src/client/index.js
  var require_index = __commonJS({
    "compiled/src/client/index.js"(exports, module) {
      var BoloLocalWorld;
      var BoloNetworkWorld;
      BoloLocalWorld = require_local2();
      BoloNetworkWorld = require_client2();
      if (location.search === "?local" || location.hostname.split(".")[1] === "github") {
        module.exports = BoloLocalWorld;
      } else {
        module.exports = BoloNetworkWorld;
      }
    }
  });
  return require_index();
})();
