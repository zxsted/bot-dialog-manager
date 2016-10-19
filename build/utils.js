"use strict";

module.exports = {
  getRandom: function getRandom(array) {
    return array[Math.floor(Math.random() * array.length)];
  }
};