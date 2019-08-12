// @textureflow/txfjs
(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (factory((global.txf = global.txf || {})));
}(this, (function(exports) { 'use strict';
  /*
    ###################    ###             ###    ###################
    ###################      ###         ###      ###################
            ###                ###     ###        ###
            ###                  ### ###          ################
            ###                    ###            ################
            ###                  ### ###          ###
            ###                ###     ###        ###
            ###              ###         ###      ###
            ###            ###             ###    ###
  */
  var c = document.createElement("canvas");
  var gl = c.getContext("webgl") || c.getContext("experimental-webgl");
  if (!gl) console.warn("WebGL not supported!");
  var e = gl.getExtension("OES_texture_float");
  if (!e) console.warn("Floating point textures not supported!");
  var v = new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]);
  var tv = new Float32Array([0, 1, 0, 0, 1, 1, 1, 0]);
  var calls = {
    elementwise: 0,
    hadamard: 0,
    multiply: 0,
    transpose: 0,
    row_append: 0,
    column_append: 0,
    softmax: 0
  };
  var fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  var create_shader = function(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  var create_program = function(vs, fs) {
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    return program;
  };
  var vs_source = "attribute vec4 a_position;\nattribute vec2 a_texcoord;\nvarying vec2 v_texcoord;\nvoid main(){\ngl_Position=a_position;\nv_texcoord=a_texcoord;\n}";
  var fs_sources = {
    elementwise: [
      "precision mediump float;",
      "varying vec2 v_texcoord;",
      "uniform sampler2D matrix;",
      "float x;",
      "void main() {",
      "  x=texture2D(matrix, v_texcoord).r;",
      "  gl_FragColor.r = operation;",
      "}"
    ],
    hadamard: [
      "precision mediump float;",
      "varying vec2 v_texcoord;",
      "uniform sampler2D mat0;",
      "uniform sampler2D mat1;",
      "float x;",
      "float y;",
      "void main() {",
      "  x = texture2D(mat0, v_texcoord).r;",
      "  y = texture2D(mat1, v_texcoord).r;",
      "  gl_FragColor.r = operation;",
      "}"
    ],
    multiply: [
      "precision mediump float;",
      "varying vec2 v_texcoord;",
      "uniform sampler2D mat0;",
      "uniform sampler2D mat1;",
      "float sum;",
      "void main() {",
      "  sum=0.0;",
      "  for(float i = initial;i<1.0;i += increment){",
      "    sum += texture2D(mat0, vec2(i, v_texcoord.y)).r*texture2D(mat1, vec2(v_texcoord.x, i)).r;",
      "  }",
      "  gl_FragColor.r = sum;",
      "}"
    ],
    transpose: [
      "precision mediump float;",
      "varying vec2 v_texcoord;",
      "uniform sampler2D matrix;",
      "void main() {",
      "  gl_FragColor.r = texture2D(matrix, v_texcoord.yx).r;",
      "}"
    ],
    fetch_column: [
      "precision mediump float;",
      "varying vec2 v_texcoord;",
      "uniform sampler2D matrix;",
      "float column = TBD;",
      "void main() {",
      "  gl_FragColor = texture2D(matrix, vec2(column, v_texcoord.y));",
      "}"
    ],
    column_append: [
      "precision mediump float;",
      "varying vec2 v_texcoord;",
      "uniform sampler2D matrix;",
      "float width=TBD;",
      "float rep = width/(width-1.0)+0.5/(width-1.0);",
      "void main() {",
      "  if (v_texcoord.x+0.75/width > 1.0){",
      "    gl_FragColor.r = 1.0;",
      "  }else{",
      "    gl_FragColor = texture2D(matrix, vec2((v_texcoord.x-0.5/width)*rep, v_texcoord.y));",
      "  }",
      "}"
    ],
    softmax: [
      "precision mediump float;",
      "varying vec2 v_texcoord;",
      "uniform sampler2D matrix;",
      "float sum;",
      "void main(){",
      "  sum = 0.0;",
      "  for (float i = initial; i < 1.0; i += increment){",
      "    sum += exp(texture2D(matrix, vec2(i, v_texcoord.y)).r);",
      "  }",
      "  gl_FragColor.r = exp(texture2D(matrix, v_texcoord).r)/sum;",
      "}"
    ]
  };

  function te(data, rows=data.length, columns=data[0].length) {
    var self = {
      texture: gl.createTexture(),
      data: null,
      rows: rows,
      columns: columns,
      to_array: function() {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
        var buffer = new Float32Array(this.columns*this.rows*4);
        gl.readPixels(0, 0, this.columns, this.rows, gl.RGBA, gl.FLOAT, buffer);
        var out = [];
        for (var i = 0; i < this.rows; i++) {
          out.push(new Array());
          for (var j = 0; j < this.columns; j++) {
            out[i].push(buffer[this.columns*4*i+j*4]);
          }
        }
        return out;
      }
    };
    if (data !== null) {
      if (data[0][0] !== undefined) {
        var processed = [];
        for (var i = 0; i < rows; i++) {
          for (var j = 0; j < columns; j++) {
            processed.push(data[i][j]); processed.push(0); processed.push(0); processed.push(0);
          }
        }
        self.data = new Float32Array(processed);
      }
      else if (data.length === rows*columns) {
        var temp = [];
        for (var i = 0; i < data.length; i++) {
          temp.push(data[i]); temp.push(0); temp.push(0); temp.push(0);
        }
        self.data = new Float32Array(temp);
      } else if (data.length !== rows*columns*4) {
        console.warn("Invalid dimensions.");
      } else {
        self.data = new Float32Array(data);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, self.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, columns, rows, 0, gl.RGBA, gl.FLOAT, self.data);
    return self;
  }

  function se(structure = []) {
    var self = {
      structure: structure,
      weights: [],
      layers: [],
      regularization_rate: "0.0",
      gradient_data: 0,
      compile: function() {
        for (var i = 0; i < this.structure.length; i++) {
          if (!i) {
            this.weights[i] = el(ra(this.structure[i].input_size+1, this.structure[i].nodes), "x*0.0000002-0.0000001");
          } else {
            this.weights[i] = el(ra(this.structure[i-1].nodes+1, this.structure[i].nodes), "x*0.0000002-0.0000001");
          }
        }
      },
      fit: function(data, labels, epochs, regularization_rate="0.0") {
        this.regularization_rate = regularization_rate;
        var biased_data = co(data);
        for (var e = 1; e <= epochs; e++) {
          this.feedforward(biased_data);
          this.backpropagate(biased_data, labels, e);
          console.log("Epoch "+e+" done.");
        }
      },
      feedforward: function(x) {
        if (this.structure.length === 1) {
          this.layers[0] = so(mu(x, this.weights[0]));
        }
        else {
          for (var i = 0; i < this.structure.length; i++) {
            if (!i) {
              this.layers[i] = co(el(mu(x, this.weights[0]), "max(0.0, x)"));
            }
            else if (i === this.structure.length-1) {
              this.layers[i] = el(mu(this.layers[i-1], this.weights[i]), "1.0/(1.0+exp(-x))");
            }
            else {
              this.layers[i] = co(el(mu(this.layers[i-1], this.weights[i]), "max(0.0, x)"));
            }
          }
        }
        return this.layers[this.layers.length-1];
      },
      backpropagate: function(data, labels, e) {
        var fs_source = [
          "precision mediump float;",
          "varying vec2 v_texcoord;"
        ];
        if (this.layers.length === 1) {
          fs_source.push("uniform sampler2D guesses;");
          fs_source.push("uniform sampler2D labels;");
          fs_source.push("void main() {gl_FragColor.r=(texture2D(guesses, v_texcoord).r-texture2D(labels, v_texcoord).r)*(texture2D(guesses, v_texcoord).r-pow(texture2D(guesses, v_texcoord).r, 2.0));}");
          var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
          var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
          var program = create_program(fragment_shader, vertex_shader);
          gl.useProgram(program);
          var guesses_location = gl.getUniformLocation(program, "guesses");
          var labels_location = gl.getUniformLocation(program, "labels");
          gl.uniform1i(guesses_location, 0);
          gl.uniform1i(labels_location, 1);
          this.gradient_data = te(null, data.rows, this.layers[0].columns);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.layers[0].texture);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, labels.texture);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gradient_data.texture, 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);



          c.width = this.weights[0].columns;
          c.height = this.weights[0].rows;
          gl.viewport(0, 0, this.weights[0].columns, this.weights[0].rows);
          fs_source = [
            "precision mediump float;",
            "varying vec2 v_texcoord;",
            "uniform sampler2D layer;",
            "uniform sampler2D weights;",
            "uniform sampler2D gradient_data;",
            "float e = "+e+".0;",
            "vec4 w;",
            "float sum;",
            "float sign;",
            "void main(){",
            "  w = texture2D(weights, v_texcoord);",
            "  sum = 0.0;",
            "  for (float i = initial; i < 1.0; i+=increment){",
            "    sum += texture2D(gradient_data, vec2(v_texcoord.x, i)).r*texture2D(layer, vec2(v_texcoord.y, i)).r+w.r*rr;",
            "  }",
            "  if (sum == 0.0 || abs(sum) == 1.0/0.0) {",
            "    sign = 0.0;",
            "  } else if (sum > 0.0) {",
            "    sign = 1.0;",
            "  } else {",
            "    sign = -1.0;",
            "  }",
            "  if (e == 1.0) {",
            "    gl_FragColor = vec4(w.r-sign*0.1, sign, 0.1, 0);",
            "  } else {",
            "    if (sign == w.g && sign != 0.0) {",
            "      gl_FragColor = vec4(w.r-sign*w.b*1.5, sign, w.b*1.5, 0);",
            "    } else if (sign != w.g) {",
            "      gl_FragColor = vec4(w.r-sign*w.b/10.0, sign, w.b/10.0, 0);",
            "    } else {",
            "      gl_FragColor = vec4(w.r, sign, w.b, 0);",
            "    }",
            "  }",
            "}"
          ];
          fs_source[12] = fs_source[12].replace("initial", 0.5/data.rows);
          if (data.rows !== 1) {
            fs_source[12] = fs_source[12].replace("increment", 1/data.rows);
          } else {
            fs_source[12] = fs_source[12].replace("increment", "1.0");
          }
          fs_source[13] = fs_source[13].replace("rr", this.regularization_rate);
          var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
          var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
          var program = create_program(fragment_shader, vertex_shader);
          gl.useProgram(program);
          var layer_location = gl.getUniformLocation(program, "layer");
          var weights_location = gl.getUniformLocation(program, "weights");
          var gd_location = gl.getUniformLocation(program, "gradient_data");
          gl.uniform1i(layer_location, 0);
          gl.uniform1i(weights_location, 1);
          gl.uniform1i(gd_location, 2);
          var temp = ze(this.weights[0].rows, this.weights[0].columns);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, data.texture);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, this.weights[0].texture);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, temp.texture);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp.texture, 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          this.weights[0] = temp;
        } else {
          for (let nx = this.weights.length-1; nx >= 0; nx--) {
            fs_source = [
              "precision mediump float;",
              "varying vec2 v_texcoord;"
            ];
            c.width = this.layers[nx].columns;
            c.height = data.rows;
            gl.viewport(0, 0, this.layers[nx].columns, data.rows);
            if (nx === this.layers.length-1) {
              fs_source.push("uniform sampler2D guesses;");
              fs_source.push("uniform sampler2D labels;");
              fs_source.push("void main() {gl_FragColor.r=(texture2D(guesses, v_texcoord).r-texture2D(labels, v_texcoord).r)*(texture2D(guesses, v_texcoord).r-pow(texture2D(guesses, v_texcoord).r, 2.0));}");
              var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
              var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
              var program = create_program(fragment_shader, vertex_shader);
              gl.useProgram(program);
              var guesses_location = gl.getUniformLocation(program, "guesses");
              var labels_location = gl.getUniformLocation(program, "labels");
              gl.uniform1i(guesses_location, 0);
              gl.uniform1i(labels_location, 1);
              this.gradient_data = te(null, data.rows, this.layers[nx].columns);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, this.layers[nx].texture);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, labels.texture);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.gradient_data.texture, 0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              c.width = this.weights[nx].columns;
              c.height = this.weights[nx].rows;
              gl.viewport(0, 0, this.weights[nx].columns, this.weights[nx].rows);
              fs_source = [
                "precision mediump float;",
                "varying vec2 v_texcoord;",
                "uniform sampler2D layer;",
                "uniform sampler2D weights;",
                "uniform sampler2D gradient_data;",
                "float e = "+e+".0;",
                "vec4 w;",
                "float sum;",
                "float sign;",
                "void main(){",
                "  w = texture2D(weights, v_texcoord);",
                "  sum = 0.0;",
                "  for (float i = initial; i < 1.0; i+=increment){",
                "    sum += texture2D(gradient_data, vec2(v_texcoord.x, i)).r*texture2D(layer, vec2(v_texcoord.y, i)).r+w.r*rr;",
                "  }",
                "  if (sum == 0.0 || abs(sum) == 1.0/0.0) {",
                "    sign = 0.0;",
                "  } else if (sum > 0.0) {",
                "    sign = 1.0;",
                "  } else {",
                "    sign = -1.0;",
                "  }",
                "  if (e == 1.0) {",
                "    gl_FragColor = vec4(w.r-sign*0.1, sign, 0.1, 0.0);",
                "  } else {",
                "    if (sign == w.g && sign != 0.0) {",
                "      gl_FragColor = vec4(w.r-sign*w.b*1.5, sign, w.b*1.5, 0);",
                "    } else if (sign != w.g) {",
                "      gl_FragColor = vec4(w.r-sign*w.b/10.0, sign, w.b/10.0, 0);",
                "    } else {",
                "      gl_FragColor = vec4(w.r, sign, w.b, 0);",
                "    }",
                "  }",
                "}"
              ];
              fs_source[12] = fs_source[12].replace("initial", 0.5/data.rows);
              if (data.rows !== 1) {
                fs_source[12] = fs_source[12].replace("increment", 1/data.rows);
              } else {
                fs_source[12] = fs_source[12].replace("increment", "1.0");
              }
              fs_source[13] = fs_source[13].replace("rr", this.regularization_rate);
              var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
              var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
              var program = create_program(fragment_shader, vertex_shader);
              gl.useProgram(program);
              var layer_location = gl.getUniformLocation(program, "layer");
              var weights_location = gl.getUniformLocation(program, "weights");
              var gd_location = gl.getUniformLocation(program, "gradient_data");
              gl.uniform1i(layer_location, 0);
              gl.uniform1i(weights_location, 1);
              gl.uniform1i(gd_location, 2);
              var temp = ze(this.weights[nx].rows, this.weights[nx].columns);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, this.layers[nx-1].texture);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, this.weights[nx].texture);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
              gl.activeTexture(gl.TEXTURE3);
              gl.bindTexture(gl.TEXTURE_2D, temp.texture);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp.texture, 0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              this.weights[nx] = temp;
            } else if (nx) {
              c.width = this.layers[nx].columns;
              c.height = data.rows;
              gl.viewport(0, 0, this.layers[nx].columns, data.rows);
              fs_source = fs_source.concat([
                "uniform sampler2D layer;",
                "uniform sampler2D weights;",
                "uniform sampler2D gradient_data;",
                "float sum;",
                "void main() {",
                "  sum = 0.0;",
                "  for (float i = initial; i < max; i += increment) {",
                "    sum += texture2D(gradient_data, vec2(i, v_texcoord.y)).r*texture2D(weights, vec2(v_texcoord.x, i)).r;",
                "  }",
                "  gl_FragColor.r = sum*float(texture2D(layer, v_texcoord).r>0.0);",
                "}"
              ]);
              fs_source[8] = fs_source[8].replace("initial", 0.5/this.layers[nx+1].columns);
              if (nx === this.layers.length-2) {
                fs_source[8] = fs_source[8].replace("max", "1.0");
              } else {
                fs_source[8] = fs_source[8].replace("max", 1-0.5/this.layers[nx+1].columns);
              }
              if (this.gradient_data.columns !== 1) {
                fs_source[8] = fs_source[8].replace("increment", 1/this.layers[nx+1].columns);
              } else {
                fs_source[8] = fs_source[8].replace("increment", "1.0");
              }
              var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
              var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
              var program = create_program(fragment_shader, vertex_shader);
              gl.useProgram(program);
              var layer_location = gl.getUniformLocation(program, "layer");
              var weights_location = gl.getUniformLocation(program, "weights");
              var gd_location = gl.getUniformLocation(program, "gradient_data");
              gl.uniform1i(layer_location, 0);
              gl.uniform1i(weights_location, 1);
              gl.uniform1i(gd_location, 2);
              var temp = te(null, data.rows, this.layers[nx].columns);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, this.layers[nx].texture);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, this.weights[nx+1].texture);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
              gl.activeTexture(gl.TEXTURE3);
              gl.bindTexture(gl.TEXTURE_2D, temp.texture);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp.texture, 0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              this.gradient_data = temp;
              c.width = this.weights[nx].columns;
              c.height = this.weights[nx].rows;
              gl.viewport(0, 0, this.weights[nx].columns, this.weights[nx].rows);
              fs_source = [
                "precision mediump float;",
                "varying vec2 v_texcoord;",
                "uniform sampler2D layer;",
                "uniform sampler2D weights;",
                "uniform sampler2D gradient_data;",
                "float e = "+e+".0;",
                "vec4 w;",
                "float sum;",
                "float sign;",
                "void main(){",
                "  w = texture2D(weights, v_texcoord);",
                "  sum = 0.0;",
                "  for (float i = initial; i < 1.0; i+=increment){",
                "    sum += texture2D(gradient_data, vec2(v_texcoord.x, i)).r*texture2D(layer, vec2(v_texcoord.y, i)).r+w.r*rr;",
                "  }",
                "  if (sum == 0.0 || abs(sum) == 1.0/0.0) {",
                "    sign = 0.0;",
                "  } else if (sum > 0.0) {",
                "    sign = 1.0;",
                "  } else {",
                "    sign = -1.0;",
                "  }",
                "  if (e == 1.0) {",
                "    gl_FragColor = vec4(w.r-sign*0.1, sign, 0.1, 0.0);",
                "  } else {",
                "    if (sign == w.g && sign != 0.0) {",
                "      gl_FragColor = vec4(w.r-sign*w.b*1.5, sign, w.b*1.5, 0);",
                "    } else if (sign != w.g) {",
                "      gl_FragColor = vec4(w.r-sign*w.b/10.0, sign, w.b/10.0, 0);",
                "    } else {",
                "      gl_FragColor = vec4(w.r, sign, w.b, 0);",
                "    }",
                "  }",
                "}"
              ];
              fs_source[12] = fs_source[12].replace("initial", 0.5/data.rows);
              if (data.rows !== 1) {
                fs_source[12] = fs_source[12].replace("increment", 1/data.rows);
              } else {
                fs_source[12] = fs_source[12].replace("increment", "1.0");
              }
              fs_source[13] = fs_source[13].replace("rr", this.regularization_rate);
              var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
              var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
              var program = create_program(fragment_shader, vertex_shader);
              gl.useProgram(program);
              var layer_location = gl.getUniformLocation(program, "layer");
              var weights_location = gl.getUniformLocation(program, "weights");
              var gd_location = gl.getUniformLocation(program, "gradient_data");
              gl.uniform1i(layer_location, 0);
              gl.uniform1i(weights_location, 1);
              gl.uniform1i(gd_location, 2);
              var temp = ze(this.weights[nx].rows, this.weights[nx].columns);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, this.layers[nx-1].texture);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, this.weights[nx].texture);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
              gl.activeTexture(gl.TEXTURE3);
              gl.bindTexture(gl.TEXTURE_2D, temp.texture);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp.texture, 0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              this.weights[nx] = temp;
            } else {
              c.width = this.layers[nx].columns;
              c.height = data.rows;
              gl.viewport(0, 0, this.layers[nx].columns, data.rows);
              fs_source = fs_source.concat([
                "uniform sampler2D layer;",
                "uniform sampler2D weights;",
                "uniform sampler2D gradient_data;",
                "float sum;",
                "void main() {",
                "  sum = 0.0;",
                "  for (float i = initial; i < max; i += increment) {",
                "    sum += texture2D(gradient_data, vec2(i, v_texcoord.y)).r*texture2D(weights, vec2(v_texcoord.x, i)).r;",
                "  }",
                "  gl_FragColor.r = sum*float(texture2D(layer, v_texcoord).r>0.0);",
                "}"
              ]);
              fs_source[8] = fs_source[8].replace("initial", 0.5/this.layers[nx+1].columns);
              if (nx === this.layers.length-2) {
                fs_source[8] = fs_source[8].replace("max", "1.0");
              } else {
                fs_source[8] = fs_source[8].replace("max", 1-0.5/this.layers[nx+1].columns);
              }
              if (this.gradient_data.columns !== 1) {
                fs_source[8] = fs_source[8].replace("increment", 1/this.layers[nx+1].columns);
              } else {
                fs_source[8] = fs_source[8].replace("increment", "1.0");
              }
              var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
              var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
              var program = create_program(fragment_shader, vertex_shader);
              gl.useProgram(program);
              var layer_location = gl.getUniformLocation(program, "layer");
              var weights_location = gl.getUniformLocation(program, "weights");
              var gd_location = gl.getUniformLocation(program, "gradient_data");
              gl.uniform1i(layer_location, 0);
              gl.uniform1i(weights_location, 1);
              gl.uniform1i(gd_location, 2);
              var temp = te(null, data.rows, this.layers[nx].columns);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, this.layers[nx].texture);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, this.weights[nx+1].texture);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
              gl.activeTexture(gl.TEXTURE3);
              gl.bindTexture(gl.TEXTURE_2D, temp.texture);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp.texture, 0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              this.gradient_data = temp;
              c.width = this.weights[nx].columns;
              c.height = this.weights[nx].rows;
              gl.viewport(0, 0, this.weights[nx].columns, this.weights[nx].rows);
              fs_source = [
                "precision mediump float;",
                "varying vec2 v_texcoord;",
                "uniform sampler2D layer;",
                "uniform sampler2D weights;",
                "uniform sampler2D gradient_data;",
                "float e = "+e+".0;",
                "vec4 w;",
                "float sum;",
                "float sign;",
                "void main(){",
                "  w = texture2D(weights, v_texcoord);",
                "  sum = 0.0;",
                "  for (float i = initial; i < 1.0; i+=increment){",
                "    sum += texture2D(gradient_data, vec2(v_texcoord.x, i)).r*texture2D(layer, vec2(v_texcoord.y, i)).r+w.r*rr;",
                "  }",
                "  if (sum == 0.0 || abs(sum) == 1.0/0.0) {",
                "    sign = 0.0;",
                "  } else if (sum > 0.0) {",
                "    sign = 1.0;",
                "  } else {",
                "    sign = -1.0;",
                "  }",
                "  if (e == 1.0) {",
                "    gl_FragColor = vec4(w.r-sign*0.1, sign, 0.1, 0.0);",
                "  } else {",
                "    if (sign == w.g && sign != 0.0) {",
                "      gl_FragColor = vec4(w.r-sign*w.b*1.5, sign, w.b*1.5, 0);",
                "    } else if (sign != w.g) {",
                "      gl_FragColor = vec4(w.r-sign*w.b/10.0, sign, w.b/10.0, 0);",
                "    } else {",
                "      gl_FragColor = vec4(w.r, sign, w.b, 0);",
                "    }",
                "  }",
                "}"
              ];
              fs_source[12] = fs_source[12].replace("initial", 0.5/data.rows);
              if (data.rows !== 1) {
                fs_source[12] = fs_source[12].replace("increment", 1/data.rows);
              } else {
                fs_source[12] = fs_source[12].replace("increment", "1.0");
              }
              fs_source[13] = fs_source[13].replace("rr", this.regularization_rate);
              var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
              var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
              var program = create_program(fragment_shader, vertex_shader);
              gl.useProgram(program);
              var layer_location = gl.getUniformLocation(program, "layer");
              var weights_location = gl.getUniformLocation(program, "weights");
              var gd_location = gl.getUniformLocation(program, "gradient_data");
              gl.uniform1i(layer_location, 0);
              gl.uniform1i(weights_location, 1);
              gl.uniform1i(gd_location, 2);
              var temp = ze(this.weights[nx].rows, this.weights[nx].columns);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, data.texture);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, this.weights[nx].texture);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, this.gradient_data.texture);
              gl.activeTexture(gl.TEXTURE3);
              gl.bindTexture(gl.TEXTURE_2D, temp.texture);
              gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temp.texture, 0);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              this.weights[nx] = temp;
            }
            if (e === 1) {
              var position_attribute_location = gl.getAttribLocation(program, "a_position");
              var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
              var position_buffer = gl.createBuffer();
              gl.enableVertexAttribArray(position_attribute_location);
              gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
              gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
              gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
              var texcoord_buffer = gl.createBuffer();
              gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
              gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
              gl.enableVertexAttribArray(texcoord_attribute_location);
              gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
            }
          }
        }
      }
    }
    return self;
  }

  function el(t, operation) {
    c.width = t.columns;
    c.height = t.rows;
    gl.viewport(0, 0, t.columns, t.rows);
    var fs_source = [...fs_sources.elementwise];
    fs_source[6] = fs_source[6].replace("operation", operation);
    var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
    var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
    var program = create_program(fragment_shader, vertex_shader);
    gl.useProgram(program);
    if (!calls.elementwise) {
      var position_attribute_location = gl.getAttribLocation(program, "a_position");
      var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
      var position_buffer = gl.createBuffer();
      gl.enableVertexAttribArray(position_attribute_location);
      gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      var texcoord_buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texcoord_attribute_location);
      gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
    };
    var matrix_location = gl.getUniformLocation(program, "matrix");
    gl.uniform1i(matrix_location, 0);
    var out = te(null, t.rows, t.columns);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, out.texture);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    calls.elementwise++;
    return out;
  }

  function ha(t, other, operation) {
      c.width = t.columns;
      c.height = t.rows;
      gl.viewport(0, 0, t.columns, t.rows);
      var fs_source = [...fs_sources.hadamard];
      fs_source[9] = fs_source[9].replace("operation", operation);
      var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
      var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
      var program = create_program(fragment_shader, vertex_shader);
      gl.useProgram(program);
      if (!calls.hadamard) {
        var position_attribute_location = gl.getAttribLocation(program, "a_position");
        var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
        var position_buffer = gl.createBuffer();
        gl.enableVertexAttribArray(position_attribute_location);
        gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
        gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
        gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
        var texcoord_buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
        gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(texcoord_attribute_location);
        gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      }
      var mat0_location = gl.getUniformLocation(program, "mat0");
      var mat1_location = gl.getUniformLocation(program, "mat1");
      gl.uniform1i(mat0_location, 0);
      gl.uniform1i(mat1_location, 1);
      var out = te(null, t.rows, t.columns);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, other.texture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, out.texture);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      calls.hadamard++;
      return out;
  }

  function mu(t, other) {
    c.width = other.columns;
    c.height = t.rows;
    gl.viewport(0, 0, other.columns, t.rows);
    var fs_source = [...fs_sources.multiply];
    fs_source[7] = fs_source[7].replace("initial", 0.5/t.columns);
    if (t.columns !== 1) {
      fs_source[7] = fs_source[7].replace("increment", 1/t.columns);
    } else {
      fs_source[7] = fs_source[7].replace("increment", "1.0");
    }
    var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
    var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
    var program = create_program(fragment_shader, vertex_shader);
    gl.useProgram(program);
    if (!calls.multiply) {
      var position_attribute_location = gl.getAttribLocation(program, "a_position");
      var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
      var position_buffer = gl.createBuffer();
      gl.enableVertexAttribArray(position_attribute_location);
      gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      var texcoord_buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texcoord_attribute_location);
      gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
    };
    var mat0_location = gl.getUniformLocation(program, "mat0");
    var mat1_location = gl.getUniformLocation(program, "mat1");
    gl.uniform1i(mat0_location, 0);
    gl.uniform1i(mat1_location, 1);
    var out = te(null, t.rows, other.columns);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, other.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, out.texture);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    calls.multiply++;
    return out;
  }

  function tr(t) {
    c.width = t.rows;
    c.height = t.columns;
    gl.viewport(0, 0, t.rows, t.columns);
    var fs_source = [...fs_sources.transpose];
    var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
    var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
    var program = create_program(fragment_shader, vertex_shader);
    gl.useProgram(program);
    if (!calls.transpose) {
      var position_attribute_location = gl.getAttribLocation(program, "a_position");
      var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
      var position_buffer = gl.createBuffer();
      gl.enableVertexAttribArray(position_attribute_location);
      gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      var texcoord_buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texcoord_attribute_location);
      gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      var matrix_location = gl.getUniformLocation(program, "matrix");
      gl.uniform1i(matrix_location, 0);
    };
    var out = te(null, t.columns, t.rows);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, out.texture);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    calls.transpose++;
    return out;
  }

  function co(t) {
    c.width = t.columns+1;
    c.height = t.rows;
    gl.viewport(0, 0, t.columns+1, t.rows);
    var fs_source = [...fs_sources.column_append];
    fs_source[3] = fs_source[3].replace("TBD", t.rows+".0");
    var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
    var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
    var program = create_program(fragment_shader, vertex_shader);
    gl.useProgram(program);
    if (!calls.column_append) {
      var position_attribute_location = gl.getAttribLocation(program, "a_position");
      var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
      var position_buffer = gl.createBuffer();
      gl.enableVertexAttribArray(position_attribute_location);
      gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      var texcoord_buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texcoord_attribute_location);
      gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
    };
    var matrix_location = gl.getUniformLocation(program, "matrix");
    gl.uniform1i(matrix_location, 0);
    var out = te(null, t.rows, t.columns+1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, out.texture);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    calls.column_append++;
    return out;
  }

  function fe(t, column) {
    c.width = 1;
    c.height = t.rows;
    gl.viewport(0, 0, 1, t.rows);
    var fs_source = [...fs_sources.fetch_column];
    fs_source[3] = fs_source[3].replace("TBD", (column-0.5)/t.columns);
    var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
    var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
    var program = create_program(fragment_shader, vertex_shader);
    gl.useProgram(program);
    if (!calls.column_append) {
      var position_attribute_location = gl.getAttribLocation(program, "a_position");
      var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
      var position_buffer = gl.createBuffer();
      gl.enableVertexAttribArray(position_attribute_location);
      gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      var texcoord_buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texcoord_attribute_location);
      gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
    };
    var matrix_location = gl.getUniformLocation(program, "matrix");
    gl.uniform1i(matrix_location, 0);
    var out = te(null, t.rows, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, out.texture);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    calls.column_append++;
    return out;
  }

  function so(t) {
    c.width = t.columns;
    c.height = t.rows;
    gl.viewport(0, 0, t.columns, t.rows);
    var fs_source = [...fs_sources.softmax];
    fs_source[6] = fs_source[6].replace("initial", 0.5/t.columns);
    if (t.columns !== 1) {
      fs_source[6] = fs_source[6].replace("increment", 1/t.columns);
    } else {
      fs_source[6] = fs_source[6].replace("increment", "1.0");
    }
    var vertex_shader = create_shader(gl.VERTEX_SHADER, vs_source);
    var fragment_shader = create_shader(gl.FRAGMENT_SHADER, fs_source.join("\n"));
    var program = create_program(fragment_shader, vertex_shader);
    gl.useProgram(program);
    if (!calls.softmax) {
      var position_attribute_location = gl.getAttribLocation(program, "a_position");
      var texcoord_attribute_location = gl.getAttribLocation(program, "a_texcoord");
      var position_buffer = gl.createBuffer();
      gl.enableVertexAttribArray(position_attribute_location);
      gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.vertexAttribPointer(position_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
      var texcoord_buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buffer);
      gl.bufferData(gl.ARRAY_BUFFER, tv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texcoord_attribute_location);
      gl.vertexAttribPointer(texcoord_attribute_location, 2, gl.FLOAT, gl.FALSE, 0, 0);
    };
    var matrix_location = gl.getUniformLocation(program, "matrix");
    gl.uniform1i(matrix_location, 0);
    var out = te(null, t.rows, t.columns);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, out.texture);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.texture, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    calls.softmax++;
    return out;
  }

  function ra(rows, columns) {
    var arr = [];
    for (var i = 0; i < rows*columns; i++) {
      arr.push(Math.random());
    }
    return te(arr, rows, columns);
  }

  function ze(rows, columns) {
    var arr = [];
    for (var i = 0; i < rows*columns; i++) {
      arr.push(0);
    }
    return te(arr, rows, columns);
  }

  function on(rows, columns) {
    var arr = [];
    for (var i = 0; i < rows*columns; i++) {
      arr.push(1);
    }
    return te(arr, rows, columns);
  }

  function id(rows) {
    var arr = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < rows; j++) {
        arr.push((i === j) | 0);
      }
    }
    return this.texture(arr, rows, rows);
  }

  exports.texture = te;
  exports.sequential = se;
  exports.elementwise = el;
  exports.hadamard = ha;
  exports.multiply = mu;
  exports.transpose = tr;
  exports.fetch_column = fe;
  exports.column_append = co;
  exports.softmax = so;
  exports.randt = ra;
  exports.zeros = ze;
  exports.ones = on;
  exports.identity = id;

  Object.defineProperty(exports, '__esModule', { value: true });

})));
