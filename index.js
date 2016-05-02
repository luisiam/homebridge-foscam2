var foscam = require("foscam-client");
var fs = require("fs");
var mkdirp = require("mkdirp");
var inherits = require('util').inherits;
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  // Characteristic "Snapshot"
  Snapshot = function () {
    Characteristic.call(this, 'Snapshot', 'B895211C-0587-11E6-8CEC-00089BDF8CC3');
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };
  inherits(Snapshot, Characteristic);

  Snapshot.UUID = 'B895211C-0587-11E6-8CEC-00089BDF8CC3';

  homebridge.registerPlatform("homebridge-foscam2", "Foscam2", FoscamPlatform, true);
}

function FoscamPlatform(log, config, api) {
  var self = this;

  self.log = log;
  self.config = config || {"platform": "Foscam2"};
  self.cameras = self.config.cameras || [];

  self.accessories = {};
  self.foscamAPI = {};
  self.cameraVer = {};
  self.cameraInfo = {};

  if (api) {
    self.api = api;
    self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this));
  }

  // HomeKit Current State: 0 (STAY_ARM), 1 (AWAY_ARM), 2 (NIGHT_ARM), 3 (DISARMED), 4 (ALARM_TRIGGERED)
  self.armState = ["Armed (Stay).", "Armed (Away).", "Armed (Night).", "Disarmed.", "Alarm Triggered."]
}

// Method to restore accessories from cache
FoscamPlatform.prototype.configureAccessory = function(accessory) {
  var self = this;

  accessory.reachable = true;

  accessory = self.setService(accessory);

  var accessoryName = accessory.context.name;
  self.accessories[accessoryName] = accessory;
}

// Method to setup accesories from config.json
FoscamPlatform.prototype.didFinishLaunching = function() {
  var self = this;

  for (var i in self.cameras) {
    var camera = self.cameras[i];

    // Add or update accessory in HomeKit
    self.addAccessory(camera);
  }
}

// Method to add or update HomeKit accessories
FoscamPlatform.prototype.addAccessory = function(camera) {
  var self = this;

  self.detectAPI(camera, function(camera, error){
    if (!error) {
      self.configureCamera(camera);
    } else {
      self.log(error);
    }
  });
}

// Method to detect Foscam API version and camera info
FoscamPlatform.prototype.detectAPI = function(camera, callback) {
  var self = this;
  var name = "[" + camera.name + "] ";

  // Setup for foscam-client
  self.foscamAPI[camera.name] = new foscam({
    username: camera.username,
    password: camera.password,
    host: camera.host,
    port: camera.port,
    protocol: 'http',
    rejectUnauthorizedCerts: true
  });

  // Detect API
  self.foscamAPI[camera.name].getMotionDetectConfig().then(function(config) {
    if (config.result == 0) {
      self.cameraVer[camera.name] = 0;
    } else {
      self.cameraVer[camera.name] = 1;
    }

    self.getInfo(camera, callback);
  })
  .catch(function(error) {
    callback(null, name + "Failed to detect API version!");
  });
}

// Method to detect Foscam API version and camera info
FoscamPlatform.prototype.getInfo = function(camera, callback) {
  var self = this;
  var name = "[" + camera.name + "] ";

  // Retrieve camera info
  self.foscamAPI[camera.name].getDevInfo().then(function(info) {
    self.cameraInfo[camera.name] = [
      info.productName.toString(),
      info.serialNo.toString(),
      info.firmwareVer.toString(),
      info.hardwareVer.toString()
    ];

    callback(camera);
  })
  .catch(function(error) {
    callback(null, name + "Failed to retrieve camera information!");
  });
}

// Method to configure camera info for HomeKit
FoscamPlatform.prototype.configureCamera = function(camera) {
  var self = this;
  var conversion = [camera.stay, camera.away, camera.night];

  if (self.cameraVer[camera.name] == 0) {
    // Older models only support 4-bit linkage
    conversion = conversion.map(function(k) {return (k & 0x0f)});
  } else {
    // Newer models support push notification bit
    conversion = conversion.map(function(k) {return (k & 0x8f)});
  }

  if (!self.accessories[camera.name]) {
    var uuid = UUIDGen.generate(camera.name);

    // Setup accessory as ALARM_SYSTEM (11) category.
    var newAccessory = new Accessory(camera.name, uuid, 11);

    // Store and initialize variables into context
    newAccessory.context.name = camera.name;
    newAccessory.context.username = camera.username;
    newAccessory.context.password = camera.password;
    newAccessory.context.host = camera.host;
    newAccessory.context.port = camera.port;
    newAccessory.context.path = camera.path;
    newAccessory.context.conversion = conversion;
    newAccessory.context.currentState = Characteristic.SecuritySystemCurrentState.DISARMED;
    newAccessory.context.targetState = Characteristic.SecuritySystemTargetState.DISARM;
    newAccessory.context.statusFault = 0;

    // Setup HomeKit security system service
    newAccessory.addService(Service.SecuritySystem, camera.name);

    // Add custom snapshot switch
    newAccessory.getService(Service.SecuritySystem).addCharacteristic(Snapshot);

    // Setup listeners for different security system events
    newAccessory = self.setService(newAccessory);

    // Retrieve initial state
    newAccessory = self.getInitState(newAccessory);

    // Register accessory in HomeKit
    self.api.registerPlatformAccessories("homebridge-foscam2", "Foscam2", [newAccessory]);
  } else {
    // Retrieve accessory from cache
    var newAccessory = self.accessories[camera.name];

    // Update variables in context
    newAccessory.context.username = camera.username;
    newAccessory.context.password = camera.password;
    newAccessory.context.host = camera.host;
    newAccessory.context.port = camera.port;
    newAccessory.context.path = camera.path;
    newAccessory.context.conversion = conversion;

    // Retrieve initial state
    newAccessory = self.getInitState(newAccessory);

    // Update accessory in HomeKit
    self.api.updatePlatformAccessories([newAccessory]);
  }

  // Store accessory in cache
  self.accessories[camera.name] = newAccessory;
}

// Method to remove accessories from HomeKit
FoscamPlatform.prototype.removeAccessory = function(accessory) {
  if (accessory) {
    var name = accessory.context.name;
    this.log("[" + name + "] Removed from HomeBridge.");
    this.api.unregisterPlatformAccessories("homebridge-foscam2", "Foscam2", [accessory]);
    delete this.accessories[name];
    delete this.foscamAPI[name];
    delete this.cameraVer[name];
    delete this.cameraInfo[name];
  }
}

// Method to setup listeners for different events
FoscamPlatform.prototype.setService = function(accessory) {
  var self = this;

  accessory
    .getService(Service.SecuritySystem)
    .getCharacteristic(Characteristic.SecuritySystemCurrentState)
    .on('get', self.getCurrentState.bind(this, accessory.context));

  accessory
    .getService(Service.SecuritySystem)
    .getCharacteristic(Characteristic.SecuritySystemTargetState)
    .on('get', self.getTargetState.bind(this, accessory.context))
    .on('set', self.setTargetState.bind(this, accessory.context));

  accessory
    .getService(Service.SecuritySystem)
    .getCharacteristic(Characteristic.StatusFault)
    .on('get', self.getStatusFault.bind(this, accessory.context));

  accessory
    .getService(Service.SecuritySystem)
    .getCharacteristic(Snapshot)
    .on('get', self.resetSwitch.bind(this))
    .on('set', self.takeSnapshot.bind(this, accessory.context));

  accessory.on('identify', self.identify.bind(this, accessory.context));

  return accessory;
}

// Method to retrieve initial state
FoscamPlatform.prototype.getInitState = function(accessory) {
  var self = this;
  var name = accessory.context.name;

  accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, "Foscam Digital Technology LLC");

  if (self.cameraInfo[name]) {
    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Model, self.cameraInfo[name][0])
      .setCharacteristic(Characteristic.SerialNumber, self.cameraInfo[name][1])
      .setCharacteristic(Characteristic.FirmwareRevision, self.cameraInfo[name][2])
      .setCharacteristic(Characteristic.HardwareRevision, self.cameraInfo[name][3]);
  }

  accessory
    .getService(Service.SecuritySystem)
    .getCharacteristic(Characteristic.SecuritySystemCurrentState)
    .getValue();

  accessory
    .getService(Service.SecuritySystem)
    .getCharacteristic(Characteristic.SecuritySystemTargetState)
    .getValue();

  accessory
    .getService(Service.SecuritySystem)
    .setCharacteristic(Snapshot, 0)

  return accessory;
}

// Method to get the current state
FoscamPlatform.prototype.getCurrentState = function(data, callback) {
  var self = this;
  var name = "[" + data.name + "] ";

  // Setup the correct promise to use
  if (self.cameraVer[data.name] == 0) {
    var getConfig = self.foscamAPI[data.name].getMotionDetectConfig();
  } else {
    var getConfig = self.foscamAPI[data.name].getMotionDetectConfig1();
  }

  getConfig.then(function(config) {
    // Set status fault accordingly
    if (config.result == 0) {
      data.statusFault = 0;
    } else {
      data.statusFault = 1;
    }

    if (!data.statusFault) {
      // Compute current state and target state
      if (config.isEnable == 0) {
        data.currentState = Characteristic.SecuritySystemCurrentState.DISARMED;
        data.targetState = Characteristic.SecuritySystemTargetState.DISARM;
      } else {
        if (data.conversion.indexOf(config.linkage) >= 0) {
          data.currentState = data.conversion.indexOf(config.linkage);
          data.targetState = data.conversion.indexOf(config.linkage);
        } else {
          data.currentState = Characteristic.SecuritySystemCurrentState.STAY_ARM;
          data.targetState = Characteristic.SecuritySystemTargetState.STAY_ARM;
        }
      }

      self.log(name + "Current state: " + self.armState[data.currentState]);
      callback(null, data.currentState);
    } else {
      callback(new Error("Failed to retrieve current state!"));
    }
  })
  .catch(function(error) {
    // Set status fault to 1 in case of error
    data.statusFault = 1;

    callback(error);
  });
}

// Method to get the target state
FoscamPlatform.prototype.getTargetState = function(data, callback) {
  setTimeout(function() {
    callback(null, data.targetState);
  }, 1000);
}

// Method to set the target state
FoscamPlatform.prototype.setTargetState = function(data, state, callback) {
  var self = this;
  var name = "[" + data.name + "] ";

  // Setup the correct promise and function to use
  if (self.cameraVer[data.name] == 0) {
    var getConfig = self.foscamAPI[data.name].getMotionDetectConfig();
    var setConfig = function(config) {self.foscamAPI[data.name].setMotionDetectConfig(config);};
  } else {
    var getConfig = self.foscamAPI[data.name].getMotionDetectConfig1();
    var setConfig = function(config) {self.foscamAPI[data.name].setMotionDetectConfig1(config);};
  }

  // Convert target state to isEnable
  var enable = state < 3 ? 1 : 0;

  // Get current config
  getConfig.then(function(config) {
    // Set status fault accordingly
    if (config.result == 0) {
      data.statusFault = 0;
    } else {
      data.statusFault = 1;
    }

    if (!data.statusFault) {
      // Change isEnable and linkage to requested state
      config.isEnable = enable;
      if (enable) config.linkage = data.conversion[state];

      // Update config with requested state
      setConfig(config);

      // Set current state
      self.accessories[data.name]
        .getService(Service.SecuritySystem)
        .setCharacteristic(Characteristic.SecuritySystemCurrentState, state);

      self.log(name + self.armState[state]);
      callback(null);
    } else {
      callback(new Error("Failed to set target state!"));
    }
  })
  .catch(function(error) {
    // Set status fault to 1 in case of error
    data.statusFault = 1;
    callback(error);
  });
}

// Method to get the status fault
FoscamPlatform.prototype.getStatusFault = function(data, callback) {
  setTimeout(function() {
    callback(null, data.statusFault);
  }, 1000);
}

// Method to take snapshots
FoscamPlatform.prototype.takeSnapshot = function(data, snapshot, callback) {
  if (snapshot) {
    var self = this;
    var name = "[" + data.name + "] ";

    self.foscamAPI[data.name].snapPicture2().then(function(jpeg) {
      // Create directory for snapshots
      mkdirp(data.path, function(error) {
        if (!error) {
          var timeStamp = new Date();

          // Write data as jpeg file to predefined directory
          fs.writeFile(data.path + "/snap_" + timeStamp.valueOf() + ".jpeg", jpeg, function(error) {
            if (!error) {
              self.log(name + "Took a snapshot.");
            } else {
              self.log(name + "Snapshot cannot be saved.");
            }
          });
        } else {
          self.log(name + "Snapshot directory cannot be created.");
        }
      });
    })
    .catch(function(error){
        self.log(name + "Snapshot cannot be created");
    });

    // Set switch back to off after 1s
    setTimeout(function(name) {
      this.accessories[name]
        .getService(Service.SecuritySystem)
        .setCharacteristic(Snapshot, 0);
    }.bind(this, data.name), 1000);
  }

  callback(null);
}

// Method to reset snapshot switch
FoscamPlatform.prototype.resetSwitch = function(callback) {
  callback(null, 0);
}

// Method to handle identify request
FoscamPlatform.prototype.identify = function(data, paired, callback) {
  var self = this;
  var name = "[" + data.name + "] ";

  self.log(name + "Identify requested!");
  callback();
}

// Method to compute linkage for different states
FoscamPlatform.prototype.computeLinkage = function(selections) {
  var linkage = 0;

  // Compute linkage according to Foscam CGI manual
  selections.sort();
  for (var i in selections) {
    if (selections[i] == 4) {
      linkage += 128;
    } else {
      linkage += Math.pow(2, selections[i]);
    }
  }

  return linkage;
}

// Method to handle plugin configuration in HomeKit app
FoscamPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
  if (request && request.type === "Terminate") {
    return;
  }

  // Instruction
  if (!context.step) {
    var instructionResp = {
      "type": "Interface",
      "interface": "instruction",
      "title": "Before You Start...",
      "detail": "Please make sure homebridge is running with elevated privileges.",
      "showNextButton": true
    }

    context.step = 1;
    callback(instructionResp);
  } else {
    switch (context.step) {
      // Operation choices
      case 1:
        var respDict = {
          "type": "Interface",
          "interface": "list",
          "title": "What do you want to do?",
          "items": [
            "Add New IP Camera",
            "Modify Existing IP Camera",
            "Remove Existing IP Camera"
          ]
        }

        context.step = 2;
        callback(respDict);
        break;
      case 2:
        var selection = request.response.selections[0];
        if (selection === 0) {
          // Info for new accessory
          var respDict = {
            "type": "Interface",
            "interface": "input",
            "title": "New IP Camera",
            "items": [{
              "id": "name",
              "title": "Name (Required)",
              "placeholder": "Entrance IP Camera"
            }, {
              "id": "username",
              "title": "Login Username (Default admin)",
              "placeholder": "admin"
            }, {
              "id": "password",
              "title": "Login Password (Required)",
              "placeholder": "password",
              "secure": true
            }, {
              "id": "host",
              "title": "IP Camera Address (Required)",
              "placeholder": "192.168.1.10"
            }, {
              "id": "port",
              "title": "IP Camera Port (Default 88)",
              "placeholder": "88"
            }, {
              "id": "path",
              "title": "Local Path for Snapshots (Required)",
              "placeholder": "/home/pi/Foscam"
            }]
          };

          context.stateConfig = 0;
          context.step = 3;
          callback(respDict);
        } else {
          var self = this;
          var cameras = Object.keys(this.accessories).map(function(k) {return self.accessories[k]});
          var names = cameras.map(function(k) {return k.displayName});

          if (names.length > 0) {
            // Select existing accessory for modification or removal
            if (selection === 1) {
              var title = "Witch IP camera do you want to modify?";
              context.modify = 1;
            } else {
              var title = "Witch IP camera do you want to remove?";
              context.modify = 0;
            }
            var respDict = {
              "type": "Interface",
              "interface": "list",
              "title": title,
              "items": names
            };

            context.cameras = cameras;
            context.step = 5;
          } else {
            // Error if no accessory is configured
            var respDict = {
              "type": "Interface",
              "interface": "instruction",
              "title": "Unavailable",
              "detail": "No IP camera is configured.",
              "showNextButton": true
            };

            context.step = 1;
          }
          callback(respDict);
        }
        break;
      case 3:
        // Configure Stay, Away, Night arm
        if (context.stateConfig == 0) {
          var title = "Configure Stay Arm";

          context.inputs = request.response.inputs;
          context.stateConfig = 1;
          context.step = 3;
        } else if (context.stateConfig == 1) {
          var title = "Configure Away Arm";

          context.inputs.stay = this.computeLinkage(request.response.selections);
          context.stateConfig = 2;
          context.step = 3;
        } else {
          var title = "Configure Night Arm";

          context.inputs.away = this.computeLinkage(request.response.selections);
          delete context.stateConfig;
          context.step = 4;
        }

        var respDict = {
          "type": "Interface",
          "interface": "list",
          "title": title,
          "allowMultipleSelection": true,
          "items": [
            "Ring",
            "Send Email",
            "Snap Picture",
            "Record",
            "Push Notification (Only on newer models)"
          ]
        };

        callback(respDict);
        break;
      case 4:
        context.inputs.night = this.computeLinkage(request.response.selections);
        var userInputs = context.inputs;
        var newCamera = {};

        // Setup info for adding or updating accessory
        if (context.selected) {
          var accessory = this.accessories[context.selected];
          newCamera.name = context.selected;
          newCamera.username = userInputs.username || accessory.context.username;
          newCamera.password = userInputs.password || accessory.context.password;
          newCamera.host = userInputs.host || accessory.context.host;
          newCamera.port = userInputs.port || accessory.context.port;
          newCamera.path = userInputs.path || accessory.context.path;
          newCamera.stay = userInputs.stay || accessory.context.conversion[0];
          newCamera.away = userInputs.away || accessory.context.conversion[1];
          newCamera.night = userInputs.night || accessory.context.conversion[2];
        } else {
          newCamera.name = userInputs.name;
          newCamera.username = userInputs.username || "admin";
          newCamera.password = userInputs.password;
          newCamera.host = userInputs.host;
          newCamera.port = userInputs.port || 88;
          newCamera.path = userInputs.path;
          newCamera.stay = userInputs.stay;
          newCamera.away = userInputs.away;
          newCamera.night = userInputs.night;
        }

        // Check for required info
        if (newCamera.name && newCamera.password && newCamera.host && newCamera.path) {
          // Add or update accessory in HomeKit
          this.addAccessory(newCamera);

          var respDict = {
            "type": "Interface",
            "interface": "instruction",
            "title": "Success",
            "detail": "The new IP camera is now updated.",
            "showNextButton": true
          };

          context.step = 6;
        } else {
          // Error if required info is missing
          var respDict = {
            "type": "Interface",
            "interface": "instruction",
            "title": "Error",
            "detail": "Some required information is missing.",
            "showNextButton": true
          };

          context.step = 1;
        }
        callback(respDict);
        break;
      case 5:
        var selection = request.response.selections[0];
        var accessory = context.cameras[selection];
        if (context.modify) {
          // Modify info of selected accessory
          var respDict = {
            "type": "Interface",
            "interface": "input",
            "title": accessory.displayName.toString(),
            "items": [{
              "id": "username",
              "title": "Login Username",
              "placeholder": "Leave blank if unchanged"
            }, {
              "id": "password",
              "title": "Login Password",
              "placeholder": "Leave blank if unchanged",
              "secure": true
            }, {
              "id": "host",
              "title": "IP Camera Address",
              "placeholder": "Leave blank if unchanged"
            }, {
              "id": "port",
              "title": "IP Camera Port",
              "placeholder": "Leave blank if unchanged"
            }, {
              "id": "path",
              "title": "Local Path for Snapshots",
              "placeholder": "Leave blank if unchanged"
            }]
          };

          context.selected = accessory.context.name;
          context.stateConfig = 0;
          context.step = 3;
        } else {
          // Remove selected accessory from HomeKit
          this.removeAccessory(accessory);
          var respDict = {
            "type": "Interface",
            "interface": "instruction",
            "title": "Success",
            "detail": "The switch is now removed.",
            "showNextButton": true
          };

          context.step = 6;
        }
        callback(respDict);
        break;
      case 6:
        // Update config.json accordingly
        var self = this;
        delete context.step;
        var newConfig = this.config;
        var newCameras = Object.keys(this.accessories).map(function(k) {
          var accessory = self.accessories[k];
          var data = {
            'name': accessory.context.name,
            'username': accessory.context.username,
            'password': accessory.context.password,
            'host': accessory.context.host,
            'port': accessory.context.port,
            'stay': accessory.context.conversion[0],
            'away': accessory.context.conversion[1],
            'night': accessory.context.conversion[2],
            'path': accessory.context.path
          };
          return data;
        });

        newConfig.cameras = newCameras;
        callback(null, "platform", true, newConfig);
        break;
    }
  }
}
