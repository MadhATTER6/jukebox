/** @jsx React.DOM */

'use strict';

var React = require('react');

require('./style.css');

module.exports = React.createClass({
  displayName: 'Controls',

  render: function(){
    return (
      <div className="controls-container">
        <div className="controls">
        </div>
      </div>
    );
  }
});
